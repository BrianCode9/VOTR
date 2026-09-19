"""Normalize free official 2026 federal/state sources. No database access."""
from pathlib import Path
from zipfile import ZipFile
from datetime import datetime, timezone
import csv, hashlib, io, json, re, subprocess, sys
sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path("data/candidates")
RAW = ROOT / "raw"
YEAR = 2026
FEC_URL = "https://www.fec.gov/files/bulk-downloads/2026/cn26.zip"
CA_URL = "https://elections.cdn.sos.ca.gov/statewide-elections/2026-general/cert-list-candidates.pdf"
MD_URL = "https://elections.maryland.gov/elections/2026/general_candidates/2026_GG_statewide_candidatelist.html"
PARTIES = {"DEM":"Democratic","REP":"Republican","LIB":"Libertarian","GRE":"Green","IND":"Independent","NPA":"No Party Affiliation","NON":"Nonpartisan","CON":"Constitution","DFL":"Democratic-Farmer-Labor","DNL":"Democratic-Nonpartisan League","WFP":"Working Families"}
REJECTIONS = []
STATES = set("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split())

def build(source_key, name, party, state, office, district_type, district, level, stage, status, source_name, source_url, record, incumbent=None, website=None, biography=None):
    assert state in STATES and level in ("federal","state")
    assert name.strip() and office and stage in ("cycle","general")
    return dict(sourceKey=source_key,name=name.strip(),party=party or None,state=state,office=office,districtType=district_type,district=str(district),level=level,electionStage=stage,candidacyStatus=status,sourceName=source_name,sourceUrl=source_url,sourceRecord=record,incumbent=bool(incumbent),incumbentKnown=incumbent is not None,campaignWebsite=website or None,biography=biography or None,electionDate="2026-11-03T00:00:00Z")

def parse_fec(text):
    output=[]
    for row in csv.reader(io.StringIO(text),delimiter="|"):
        if len(row)!=15:
            raise ValueError("Unexpected FEC column count")
        ident,name,party,year,state,office,district,ici,status,pcc,*_ = row
        # Official general rosters take precedence in CA/MD. No prior-cycle or future records.
        if year!="2026" or office not in ("H","S") or state not in STATES or state in ("CA","MD") or status not in ("C","N"):
            continue
        if not re.fullmatch(r"[HS][A-Z0-9]{8}",ident) or not name or (office=="H" and not district.isdigit()):
            REJECTIONS.append(dict(sourceKey=ident,reason="Missing or invalid identity/name/House district"))
            continue
        parts=name.split(",",1)
        display=(parts[1].strip()+" "+parts[0].strip()) if len(parts)==2 else name
        record=dict(fecId=ident,partyCode=party,electionYear=int(year),officeCode=office,officeDistrict=district,incumbentCode=ici,candidateStatusCode=status,principalCommitteeId=pcc,ballotVerified=False)
        output.append(build("fec:2026:"+ident,display,PARTIES.get(party,party),state,"U.S. House" if office=="H" else "U.S. Senate","congressional" if office=="H" else "us_senate",str(int(district)) if office=="H" else "statewide","federal","cycle","fec_filing_not_ballot_verified","Federal Election Commission",f"https://www.fec.gov/data/candidate/{ident}/?cycle=2026",record,ici=="I" if ici in ("I","C","O") else None))
    return output

def ca_office(line):
    statewide={"Governor":"governor","Lieutenant Governor":"lieutenant_governor","Secretary of State":"secretary_of_state","Controller":"controller","Treasurer":"treasurer","Attorney General":"attorney_general","Insurance Commissioner":"insurance_commissioner","Superintendent of Public Instruction":"superintendent"}
    if line in statewide:
        return line,statewide[line],"statewide","state"
    for pattern,office,kind,level in [
        (r"Board of Equalization Member District (\d+)","Board of Equalization","board_of_equalization","state"),
        (r"United States Representative District (\d+)","U.S. House","congressional","federal"),
        (r"State Senat(?:e|or) District (\d+)","State Senate","state_senate","state"),
        (r"Member of the State Assembly District (\d+)","State Assembly","state_house","state"),
        (r"State Assembly Member District (\d+)","State Assembly","state_house","state"),
        (r"State Assembly District (\d+)","State Assembly","state_house","state"),
    ]:
        m=re.fullmatch(pattern,line)
        if m: return office,kind,m[1],level
    return None

def parse_ca(text):
    output=[]
    context=None
    lines=text.splitlines()
    for i,line in enumerate(lines):
        line=line.strip()
        if "Justice" in line or "Court of Appeal" in line: context=None
        office=ca_office(line)
        if office: context=office; continue
        m=re.fullmatch(r"(.+?)\s{2,}(Democratic|Republican|Non-Partisan|Green|Libertarian|American Independent|Peace and Freedom|None|No Party Preference)",line)
        if not m: continue
        if context is None: raise ValueError("Candidate without office: "+line)
        name,party=m.groups()
        incumbent=True if "*" in name else None
        name=name.replace("*","").strip()
        office,kind,district,level=context
        bio=lines[i+1].strip() if i+1<len(lines) else ""
        output.append(build(f"ca:2026:{kind}:{district}:{name}",name,"Nonpartisan" if party=="Non-Partisan" else party,"CA",office,kind,district,level,"general","certified_general_candidate","California Secretary of State",CA_URL,dict(ballotDesignation=bio,partyLabel=party,certifiedDate="2026-08-27"),incumbent,biography=bio))
    return output

def parse_md(text):
    output=[]
    offices={"Governor / Lt. Governor":("Governor","governor"),"Comptroller":("Comptroller","comptroller"),"Attorney General":("Attorney General","attorney_general"),"Representative in Congress":("U.S. House","congressional"),"State Senator":("State Senate","state_senate"),"House of Delegates":("House of Delegates","state_house")}
    for row in csv.DictReader(io.StringIO(text.lstrip("\ufeff"))):
        label=row["Office Name"]
        if label not in offices or row["Candidate Status"]!="Active": continue
        office,kind=offices[label]
        district_label=row["Contest Run By District Name and Number"]
        district="statewide"
        if kind in ("congressional","state_senate","state_house"):
            m=re.search(r"(\d+[A-Za-z]?)\s*$",district_label)
            if not m: raise ValueError("Unknown Maryland district "+district_label)
            district=re.sub(r"^0+(?=\d)","",m[1]).upper()
        name=(row["Candidate First Name and Middle Name"]+" "+row["Candidate Ballot Last Name and Suffix"]).strip()
        filing=row["Filing Type and Date"]
        status="general_write_in" if filing.startswith("Write-In") else "official_general_candidate"
        website=row["Website"].strip()
        if website and not website.startswith(("https://","http://")): website="https://"+website
        record=dict(filingTypeAndDate=filing,sourceStatus=row["Candidate Status"],districtLabel=district_label)
        partner=(row["Related Candidate First Name and Middle Name"]+" "+row["Related Candidate Last Name and Suffix"]).strip()
        if partner: record["ticketPartner"]=partner
        output.append(build(f"md:2026:{kind}:{district}:{name}",name,row["Office Political Party"],"MD",office,kind,district,"federal" if kind=="congressional" else "state","general",status,"Maryland State Board of Elections",MD_URL,record,website=website))
        if partner and kind=="governor":
            output.append(build(f"md:2026:lieutenant_governor:statewide:{partner}",partner,row["Related Office Political Party"],"MD","Lieutenant Governor","lieutenant_governor","statewide","state","general",status,"Maryland State Board of Elections",MD_URL,dict(ticketPartner=name,filingTypeAndDate=row["Related Candidate Filing Type and Date"]),website=website))
    return output

def main():
    with ZipFile(RAW/"fec.zip") as archive:
        fec=archive.read("cn.txt").decode("utf-8-sig")
    subprocess.run(["pdftotext","-layout",str(RAW/"ca.pdf"),str(RAW/"ca.txt")],check=True)
    ca=parse_ca((RAW/"ca.txt").read_text(encoding="utf-8"))
    md=parse_md((RAW/"md.csv").read_text(encoding="utf-8-sig"))
    federal=parse_fec(fec)
    assert sum(r["office"]=="State Senate" for r in ca)==40, "California Senate heading mismatch"
    assert sum(r["office"]=="U.S. House" for r in ca)==104, "California House count mismatch"
    assert len(ca)>250, f"California parse incomplete: {len(ca)}"
    assert len(md)>100, f"Maryland parse incomplete: {len(md)}"
    assert len(federal)>500, f"FEC parse incomplete: {len(federal)}"
    records=ca+md+federal
    assert len({r["sourceKey"] for r in records})==len(records),"Duplicate source identity"
    snapshot=dict(year=YEAR,preparedAt=datetime.now(timezone.utc).isoformat(),sources=[dict(url=url,sha256=hashlib.sha256((RAW/file).read_bytes()).hexdigest(),retrievedAt=datetime.fromtimestamp((RAW/file).stat().st_mtime,timezone.utc).isoformat()) for file,url in [("fec.zip",FEC_URL),("ca.pdf",CA_URL),("md.csv",MD_URL.replace(".html",".csv"))]],candidates=records,rejections=REJECTIONS)
    (ROOT/"candidates-2026.json").write_text(json.dumps(snapshot,ensure_ascii=False,indent=2),encoding="utf-8")
    from collections import Counter
    print(json.dumps(dict(total=len(records),sources=dict(Counter(r["sourceName"] for r in records)),levels=dict(Counter(r["level"] for r in records)),caOffices=dict(Counter(r["office"] for r in ca)),mdOffices=dict(Counter(r["office"] for r in md))),indent=2))
if __name__=="__main__": main()

