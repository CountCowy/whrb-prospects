"""Per-source timing + row-count benchmark. Not run by the pipeline."""
import time
import signal

def run(label, fn, timeout=120):
    def handler(signum, frame):
        raise TimeoutError(f"{label} exceeded {timeout}s")
    signal.signal(signal.SIGALRM, handler)
    signal.alarm(timeout)
    t0 = time.time()
    try:
        rows = fn()
        dt = time.time() - t0
        print(f"{label:20s} OK   {dt:6.1f}s  {len(rows):6d} rows")
    except Exception as e:
        dt = time.time() - t0
        print(f"{label:20s} FAIL {dt:6.1f}s  {type(e).__name__}: {str(e)[:80]}")
        return 1
    finally:
        signal.alarm(0)

from sources import (osm_overpass, yelp_fusion, ma_hic, city_licenses,
                     chambers, best_of_boston, program_books)
from sources.program_books_fetcher import huntington_sponsors

print("== per-source benchmark ==")
run("osm",            osm_overpass.run_all, timeout=120)
run("yelp",           yelp_fusion.run_all,  timeout=180)
#run("ma_hic",         ma_hic.run_all,       timeout=120)
run("city_licenses",  city_licenses.run_all, timeout=60)
run("chambers",       chambers.run_all,     timeout=60)
run("best_of_boston", best_of_boston.run_all, timeout=30)
run("huntington",     huntington_sponsors,  timeout=30)
# program_books autofetch already done; just parse existing PDFs
run("program_books",  lambda: program_books.run_all(auto_fetch=False), timeout=60)
