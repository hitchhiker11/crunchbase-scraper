# Workflow State

## Current Phase
BLUEPRINT

## Status
NEEDS_PLAN_APPROVAL

## Plan
1. Install Puppeteer.
2. Create `financial_scraper_module.js`.
3. Modify `pipeline_config.json`.
4. Modify `run_pipeline.js`.
5. Modify `merge_data_module.js`.
6. Modify `pivot_rounds_module.js`.
7. Modify `financial_scraper_module.js` for Incremental JSONL Saving.
8. Modify Config/Pipeline for JSONL.
9. Modify Downstream Modules for JSONL Parsing.
10. Define Project Structure.
11. Move Files.
12. Update Paths in `pipeline_config.json`.
13. Update Paths in `src/run_pipeline.js`.
14. Verify Module Paths.
15. **Refine Puppeteer Table Selector:** Update the CSS selector in `financial_scraper_module.js` to `company-funding tile-table table` for better stability based on user feedback and provided locators.
16. **Improve Pipeline Skipping Logic:** Add explicit checks for required *input* files before running a step. If input is missing and the generating step was skipped, throw a clear error instead of potentially stopping silently or only skipping dependents.
17. **Parallelize Puppeteer Scraping using Worker Threads:**
    *   Add worker count option to `config/pipeline_config.json`.
    *   Modify `src/modules/financial_scraper_module.js` to act as a worker manager: split company list, launch workers, handle messages (results/errors), write aggregated results to JSONL from main thread.
    *   Create `src/modules/financial_scraper_worker.js`: Receive company chunk, launch own browser, scrape assigned companies, send results back via `postMessage`.

## Log
*   Created `workflow_state.md`.
*   Outlined refactoring plan for `app.js`.
*   Refactored `app.js` to support multiple configurations and improve structure.
*   Outlined plan to update `postprocess.js` and `to_csv.js` for multi-type support.
*   Modified `postprocess.js` and `to_csv.js` to handle `companies` and `fundingRounds` types via `--type` argument.
*   Outlined plan to merge `companies` and `fundingRounds` data into a single output.
*   Modified `postprocess.js` to include `Organization Permalink` for companies.
*   Created `merge_data.js` to combine processed company and funding round data (long format).
*   Modified `to_csv.js` to support `--type=merged` for converting the combined data.
*   Paused "Idea X" (refactoring financials fetching via GET request).
*   Outlined plan to modify `merge_data.js` (output long format only) and create `pivot_rounds.js` (for wide format), updating `to_csv.js` accordingly.
*   Modified `merge_data.js` to output `merged_data_long.json`.
*   Created `pivot_rounds.js` to convert long format to wide format (`merged_data_wide.json`).
*   Modified `to_csv.js` to support `--type=merged_long` and `--type=merged_wide`.
*   Outlined plan to ensure original company order from `processed_companies.json` is preserved in merged outputs.
*   Modified `merge_data.js` to group rounds first and iterate companies in order, removing final sort.
*   Modified `pivot_rounds.js` to read both source files, group rounds, iterate companies in order, and remove final sort.
*   Outlined plan for major refactoring into a single pipeline script (`run_pipeline.js`) controlled by `pipeline_config.json` with cleanup.
*   Created `pipeline_config.json`.
*   Created initial `run_pipeline.js` structure.
*   Refactored `app.js` to `app_module.js`, updated `run_pipeline.js`.
*   Refactored `postprocess.js` to `postprocess_module.js`, updated `run_pipeline.js`.
*   Refactored `merge_data.js` to `merge_data_module.js`, updated `run_pipeline.js`.
*   Refactored `pivot_rounds.js` to `pivot_rounds_module.js`, updated `run_pipeline.js`.
*   Refactored `to_csv.js` to `to_csv_module.js`, updated `run_pipeline.js`.
*   Completed initial refactoring to modular pipeline structure.
*   Reviving "Idea X": Outlined plan to replace funding rounds API fetching with Puppeteer scraping of the financial details table.
*   Installed Puppeteer.
*   Created `financial_scraper_module.js` with Puppeteer logic.
*   Updated `pipeline_config.json` for the new scraping step.
*   Updated `run_pipeline.js` to integrate `financial_scraper_module.js`.
*   Updated `merge_data_module.js` to use scraped financials data.
*   Updated `pivot_rounds_module.js` to use scraped financials data and adjusted pivoted fields.
*   Completed implementation of Puppeteer-based financial details scraping within the pipeline.
*   Outlined plan to implement incremental saving in `financial_scraper_module.js` using JSONL format and update downstream modules.
*   Modified `financial_scraper_module.js` to save data incrementally to `.jsonl` file.
*   Updated `pipeline_config.json` to use `.jsonl` extension for scraped financials.
*   Modified `merge_data_module.js` to parse JSONL input.
*   Modified `pivot_rounds_module.js` to parse JSONL input.
*   Updated cleanup step in `run_pipeline.js` for `.jsonl` file.
*   Completed implementation of incremental saving for Puppeteer scraper.
*   Outlined plan for project file structure reorganization.
*   Created directory structure.
*   Moved files to the new structure.
*   Updated paths in `config/pipeline_config.json`.
*   Updated paths and logic in `src/run_pipeline.js` to handle the new structure and config.
*   Verified modules use passed-in paths.
*   Completed project structure reorganization.
*   Debugging Puppeteer timeout error: User provided alternative selectors.
*   Outlined plan to use a more robust selector `company-funding tile-table table`.
*   Updated `financial_scraper_module.js` with the refined selector.
*   Completed attempt to fix Puppeteer table selection.
*   Debugging pipeline: Script stops when initial steps are skipped.
*   Outlined plan to add explicit input file checks before running each step.
*   Completed implementation of incremental saving for Puppeteer scraper.
*   Completed project structure reorganization.
*   Completed attempt to fix Puppeteer table selection.
*   Identified Puppeteer scraping as bottleneck. Discussed async vs. worker threads.
*   Outlined plan to implement parallel scraping using Worker Threads for significant speedup. 