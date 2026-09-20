"""Regression checks for real source parsing failure modes."""
import importlib.util
import unittest
spec=importlib.util.spec_from_file_location("candidate_parser","scripts/prepare-candidate-data.py")
parser=importlib.util.module_from_spec(spec)
spec.loader.exec_module(parser)

class SourceParsingTests(unittest.TestCase):
    def test_california_senate_heading_does_not_inherit_house(self):
        records=parser.parse_ca("United States Representative District 52\nJane Example  Democratic\nTeacher\nState Senate District 2\nSam Example*  Republican\nState Senator\n")
        self.assertEqual([(r["office"],r["level"]) for r in records],[("U.S. House","federal"),("State Senate","state")])
        self.assertFalse(records[0]["incumbentKnown"])
        self.assertTrue(records[1]["incumbent"])
    def test_fec_prior_cycles_and_unconfirmed_districts(self):
        def row(ident,year,office,district,status="C"):
            return "|".join([ident,"EXAMPLE, JANE","DEM",year,"TX",office,district,"",status,"","","","","",""])
        records=parser.parse_fec("\n".join([row("H6TX01111","2026","H","1"),row("H4TX01111","2024","H","1"),row("H6TX02111","2026","H",""),row("S6TX00111","2026","S","")]))
        self.assertEqual(len(records),2)
        self.assertTrue(all(r["electionStage"]=="cycle" for r in records))
        self.assertTrue(all(r["candidacyStatus"]=="fec_filing_not_ballot_verified" for r in records))
        self.assertEqual(records[1]["district"],"statewide")
    def test_fec_name_moves_the_suffix_behind_the_surname(self):
        # Both shapes the FEC publishes: suffix in its own comma field, and
        # suffix glued to the end of the given names.
        self.assertEqual(parser.fec_name("CARL, JERRY LEE, JR")[0],"JERRY LEE CARL JR")
        self.assertEqual(parser.fec_name("KELLY, GEORGE J JR")[0],"GEORGE J KELLY JR")
        self.assertEqual(parser.fec_name("GRAVES, SAMUEL B. JR.")[0],"SAMUEL B. GRAVES JR.")
        self.assertEqual(parser.fec_name("BEGICH, NICHOLAS III")[0],"NICHOLAS BEGICH III")
        # The suffix is sometimes filed ahead of the given names.
        self.assertEqual(parser.fec_name("WILLIAMS, III, PERTIS HERMAN")[0],"PERTIS HERMAN WILLIAMS III")
    def test_fec_name_drops_titles_but_records_them(self):
        display,dropped=parser.fec_name("MCGUIRE, JOHN J. MR. III")
        self.assertEqual(display,"JOHN J. MCGUIRE III")
        self.assertEqual(dropped,["MR."])
        self.assertEqual(parser.fec_name("CONAWAY, HERB MD")[0],"HERB CONAWAY")
        self.assertEqual(parser.fec_name("DUNN, NEAL PATRICK MD, FACS")[0],"NEAL PATRICK DUNN")
        self.assertEqual(parser.fec_name("WENDELIN, STEVEN COMMANDER USN, (RET)")[0],"STEVEN WENDELIN")
        self.assertEqual(parser.fec_name("WOMACK, STEPHEN A THE HON")[0],"STEPHEN A WOMACK")
        self.assertEqual(parser.fec_name("PIERCE, MICHAEL DAVID LTC (RET.)")[0],"MICHAEL DAVID PIERCE")
    def test_fec_name_keeps_initials_that_look_like_suffixes(self):
        # "I" is a middle initial in every row the FEC publishes, and a single
        # letter written with a period is an initial even when it is a numeral.
        self.assertEqual(parser.fec_name("COLLINS, KINA I")[0],"KINA I COLLINS")
        self.assertEqual(parser.fec_name("HILLEARY, WILLIAM V.")[0],"WILLIAM V. HILLEARY")
        # A bare "V" after a title is the generational suffix.
        self.assertEqual(parser.fec_name("MARKERT, GEORGE WASHINGTON MR V")[0],"GEORGE WASHINGTON MARKERT V")
    def test_fec_name_prints_a_doubled_suffix_once(self):
        # The suffix is filed in the surname field and after the given names.
        self.assertEqual(parser.fec_name("JOHNSON II, CRAIG HENLEY MR II")[0],"CRAIG HENLEY JOHNSON II")
        # A suffix carried only by the surname field is already in place.
        self.assertEqual(parser.fec_name("CLEAVER II, EMANUEL")[0],"EMANUEL CLEAVER II")
        self.assertEqual(parser.fec_name("ONDER JR, ROBERT FRANK")[0],"ROBERT FRANK ONDER JR")
    def test_fec_name_survives_malformed_fields(self):
        self.assertEqual(parser.fec_name("BRINK,, BRIDGET")[0],"BRIDGET BRINK")
        self.assertEqual(parser.fec_name("FIERRO, MARTHA ELENA,")[0],"MARTHA ELENA FIERRO")
        # No comma means no surname to move, so the field is published as filed.
        self.assertEqual(parser.fec_name("JOHN ARMENIAN")[0],"JOHN ARMENIAN")
        # A name that is nothing but titles keeps them rather than printing a
        # bare surname.
        self.assertEqual(parser.fec_name("RAZACK, MD JD")[0],"MD JD RAZACK")
    def test_fec_records_carry_the_filed_name(self):
        def row(ident,name):
            return "|".join([ident,name,"REP","2026","TX","H","1","","C","","","","","",""])
        records=parser.parse_fec(row("H6TX01111","KELLY, GEORGE J JR"))
        self.assertEqual(records[0]["name"],"GEORGE J KELLY JR")
        self.assertEqual(records[0]["sourceRecord"]["filedName"],"KELLY, GEORGE J JR")
    def test_california_unknown_context_fails_closed(self):
        with self.assertRaises(ValueError):
            parser.parse_ca("Unrecognized Office District 2\nJane Example  Democratic\n")
if __name__=="__main__":unittest.main()

