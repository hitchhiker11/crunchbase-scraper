const fs = require("fs");
const fetch = require("node-fetch");

// --- Logging Utility (Keep local or make injectable) ---
// For simplicity, keep it local for now, but prefix logs
function logScraper(message) {
    const time = new Date().toISOString();
    const line = `[${time}] [SCRAPER] ${message}`;
    console.log(line);
    // Optionally log to a specific scraper log file if needed
    // fs.appendFileSync(LOG_FILE, line + "\n");
}

// --- Cookie Handling ---
function stringifyCookies(cookieArray) {
    return cookieArray.map(c => `${c.name}=${c.value}`).join("; ");
}

function loadCookies(filePath) {
    // Using logScraper for consistency within this module
    try {
        const cookieData = fs.readFileSync(filePath, "utf-8");
        return JSON.parse(cookieData);
    } catch (error) {
        logScraper(`❌ Error loading cookies from ${filePath}: ${error.message}`);
        logScraper(`Ensure ${filePath} exists and contains a valid JSON array of cookie objects.`);
        // Throw error instead of exiting, let the pipeline handle it
        throw new Error(`Failed to load cookies from ${filePath}`);
    }
}

// --- Shared Headers (Now built inside runScraper) ---
const BASE_SHARED_HEADERS = {
    "accept": "application/json, text/plain, */*",
    "content-type": "application/json",
    "x-requested-with": "XMLHttpRequest",
    "sec-ch-ua-mobile": "?0",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "accept-language": "en-US,en;q=0.9,ru;q=0.8",
    "priority": "u=1, i"
};


// --- Request Configurations (Keep internal to this module) ---
const CONFIG = {
    companies: {
        name: "Companies",
        baseUrl: "https://www.crunchbase.com/v4/data/searches/organization.companies?source=slug_advanced_search",
        baseBody: {
            "field_ids": [
                "identifier", "categories", "location_identifiers", "short_description", "rank_org",
                "xrm_deal_stages", "rank_org_company", "founded_on", "investor_type", "investor_stage",
                "num_investments_funding_rounds", "num_funding_rounds", "funding_stage", "last_funding_type",
                "funding_total", "last_funding_total", "num_investors", "revenue_range"
            ],
            "order": [{ "field_id": "rank_org", "sort": "asc" }],
            "query": [
                {
                    "type": "predicate",
                    "field_id": "categories",
                    "operator_id": "includes",
                    "values": ["c4d8caf3-5fe7-359b-f9f2-2d708378e4ee"] // Example Category
                },
                {
                    "type": "predicate",
                    "field_id": "location_identifiers",
                    "operator_id": "includes",
                    "values": ["c6489798-402c-a5b4-fe77-09247eee9900", "6085b4bf-b18a-1763-a04e-fdde3f6aba94"] // Example Locations
                }
            ],
            "field_aggregators": [],
            "collection_id": "organization.companies",
        },
        headers: {
            "Referer": "https://www.crunchbase.com/discover/organization.companies",
            "x-cb-client-app-instance-id": "fbba7b13-e80a-4734-8d6c-32cedc990296" // Specific instance ID from original script
        },
        resultFile: "companies.json",
        limit: 100,
        entityIdField: 'uuid', // Assuming pagination is based on the entity's uuid
        totalEntities: 1902 // Optional: For progress tracking
    },
    fundingRounds: {
        name: "Funding Rounds",
        baseUrl: "https://www.crunchbase.com/v4/data/searches/funding_rounds?source=custom_advanced_search",
        baseBody: {
            "field_ids":[
                "funded_organization_identifier","funded_organization_description","funded_organization_categories",
                "funded_organization_location","investment_type","money_raised","announced_on",
                "funded_organization_num_funding_rounds","num_investors","funded_organization_funding_total",
                "funded_organization_funding_stage","lead_investor_identifiers","investor_identifiers",
                "investment_stage","is_equity","sentiment","pre_money_valuation",
                "funded_organization_revenue_range","funded_organization_diversity_spotlights",
                "funded_organization_website","num_partners","rank_funding_round"
            ],
            "order": [], // Corrected
            "query": [/* ... query ... */], // Keep query details here
            "field_aggregators": [],
            "collection_id": "funding_rounds",
        },
        headers: {
            "Referer": "https://www.crunchbase.com/discover/funding_rounds/3193f717cd0c30b554bd71647e6c84af", // Example referer
            "Referrer-Policy": "same-origin",
            "x-cb-client-app-instance-id": "372a60b2-0087-40cd-a427-41c8308787e1"
        },
        entityIdField: 'uuid',
        // totalEntities: null
    }
};

// --- Core Fetching Logic ---
async function fetchPage(url, requestBody, requestHeaders, pauseMs) {
    const body = { ...requestBody }; // Clone base body
    if (body.after_id) { // check if after_id exists before logging
       logScraper(`📤 Sending request to ${url} with after_id = ${body.after_id}...`);
    } else {
       logScraper(`📤 Sending request to ${url}...`);
    }

    const startTime = Date.now();

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: requestHeaders,
            body: JSON.stringify(body)
        });

        const duration = (Date.now() - startTime) / 1000;
        logScraper(`⏱ Response received in ${duration.toFixed(2)} sec`);

        if (!response.ok) {
            const errorBody = await response.text();
            logScraper(`❌ Request Error: ${response.status} ${response.statusText}`);
            logScraper(`❌ Response Body: ${errorBody}`);
            // Throw specific error code or message if possible
            throw new Error(`Fetch error ${response.status}: ${response.statusText}`);
        }

        // Pause after successful fetch, before returning data
        if (pauseMs > 0) {
             logScraper(`⏸️ Pausing for ${pauseMs / 1000} sec...`);
             await new Promise((r) => setTimeout(r, pauseMs));
        }


        return response.json();

    } catch (error) {
        logScraper(`🔥 Network or Fetch Error: ${error.message}`);
        throw error; // Re-throw to be caught by the main loop
    }
}

// --- Main Exportable Function ---
// Takes type ('companies' or 'fundingRounds') and pipeline config details
async function runScraper(type, pipelineConfig) {

    const specificConfig = CONFIG[type];
    if (!specificConfig) {
        logScraper(`❌ Invalid scraper type specified: ${type}`, 'error');
        return false; // Indicate failure
    }

    const { inputFilePaths, options } = pipelineConfig;
    const cookieFilePath = inputFilePaths.cookies;
    const outputFilePath = type === 'companies' ? inputFilePaths.rawCompanies : inputFilePaths.rawFundingRounds;
    const pauseMs = options.scraperPauseMs || 1000; // Default pause

    // Clear previous raw file (optional, but good practice)
    try {
       if (fs.existsSync(outputFilePath)) {
           fs.unlinkSync(outputFilePath);
           logScraper(`🗑️ Deleted previous raw file: ${outputFilePath}`);
       }
    } catch (err) {
       logScraper(`⚠️ Could not delete previous raw file ${outputFilePath}: ${err.message}`, 'warn');
    }


    logScraper(`🚀 Starting scrape for: ${specificConfig.name}`);

    let cookieArray;
    try {
        cookieArray = loadCookies(cookieFilePath);
    } catch (err) {
        logScraper(`Stopping scraper due to cookie load failure.`, 'error');
        return false; // Indicate failure
    }

    const cookieHeader = stringifyCookies(cookieArray);
    const dynamicHeaders = {
        ...BASE_SHARED_HEADERS,
        ...specificConfig.headers, // Specific headers for this config
        "cookie": cookieHeader
    };

    let results = [];
    let after_id = null;
    let fetchedCount = 0;
    let page = 0;
    const total = specificConfig.totalEntities; // Use total from internal config for now
    const progressSuffix = total ? `/${total}` : "";
    let success = true; // Track success

    while (true) {
        page++;
        logScraper(`📦 Iteration #${page} for ${specificConfig.name}`);

        const bodyForPage = { ...specificConfig.baseBody, limit: specificConfig.limit || 100 }; // Use specific limit or default
        if (after_id) {
            bodyForPage.after_id = after_id;
        }

        try {
            const data = await fetchPage(specificConfig.baseUrl, bodyForPage, dynamicHeaders, page > 1 ? pauseMs : 0); // No pause before first request
            const entities = data.entities || [];

            if (!Array.isArray(entities)) {
                logScraper(`⚠️ Expected 'entities' to be an array, but got: ${typeof entities}. Stopping.`);
                logScraper(`Data received: ${JSON.stringify(data)}`);
                success = false; // Mark as failed if response structure is wrong
                break;
            }

            if (entities.length === 0) {
                logScraper(`⏹️ Received 0 entities. Assuming end of data.`);
                break;
            }

            results.push(...entities);
            fetchedCount += entities.length;

            const lastEntity = entities[entities.length - 1];
            // Adjusted check for pagination ID using optional chaining
            const next_after_id = lastEntity?.[specificConfig.entityIdField];

            if (next_after_id === undefined || next_after_id === null) {
                 logScraper(`🛑 Error: Could not find or extract valid entityIdField ('${specificConfig.entityIdField}') in the last entity of page ${page}. Cannot paginate further.`);
                 logScraper(`Last entity received: ${JSON.stringify(lastEntity)}`);
                 success = false; // Mark as failed if pagination breaks
                 break;
             }
            after_id = next_after_id;


            logScraper(`✅ Fetched ${entities.length} ${specificConfig.name}. Total: ${fetchedCount}${progressSuffix}`);
            logScraper("-".repeat(40));

            if (total && fetchedCount >= total) {
                logScraper(`🏁 Reached target entity count (${total}). Stopping.`);
                break;
            }

        } catch (err) {
            logScraper(`🔥 Error during iteration #${page}: ${err.message}`);
            logScraper(`🛑 Scraper stopped due to error.`);
            success = false; // Mark as failed
            break;
        }

        // Removed pause from here, moved inside fetchPage
    }

    if (success) {
        logScraper(`🎉 Scraping finished for ${specificConfig.name}. Total entities fetched: ${results.length}`);
        try {
            fs.writeFileSync(outputFilePath, JSON.stringify(results, null, 2));
            logScraper(`📁 Data saved to ${outputFilePath}`);
        } catch (writeError) {
            logScraper(`🔥 Error writing results to ${outputFilePath}: ${writeError.message}`);
            success = false; // Mark as failed if write fails
        }
    } else {
         logScraper(`🔥 Scraping failed for ${specificConfig.name}. No output file generated.`);
    }

    return success; // Return success status
}

// --- Export the main function ---
module.exports = {
    runScraper
    // Optionally export other utilities if needed elsewhere, e.g.:
    // loadCookies,
    // stringifyCookies
};

// --- REMOVE direct execution block ---
// const configToRun = CONFIG[CURRENT_CONFIG_KEY];
// ... runScraper call ... 