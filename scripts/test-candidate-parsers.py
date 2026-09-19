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
    def test_california_unknown_context_fails_closed(self):
        with self.assertRaises(ValueError):
            parser.parse_ca("Unrecognized Office District 2\nJane Example  Democratic\n")
if __name__=="__main__":unittest.main()

