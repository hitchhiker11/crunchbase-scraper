const fs = require("fs");

// --- Logging Utility ---
function logPivot(message) {
    const time = new Date().toISOString();
    console.log(`[${time}] [PIVOT_WIDE] ${message}`);
}

// --- Function to parse JSONL (duplicate from merge_data - could be moved to a utils file) ---
function parseJsonl(fileContent) {
     if (!fileContent || typeof fileContent !== 'string') {
        return [];
    }
    return fileContent
        .trim()
        .split('\n')
        .filter(line => line.trim() !== '')
        .map((line, index) => {
            try {
                return JSON.parse(line);
            } catch (e) {
                logPivot(`⚠️ Error parsing JSONL line ${index + 1}: ${e.message}. Line: "${line}"`);
                return null;
            }
        })
        .filter(obj => obj !== null);
}

// --- Main Exportable Function ---
async function runPivoting(companiesFile, scrapedFinancialsFile, outputFile) {
    logPivot(`Starting pivoting process (long to wide format)...`);
    logPivot(`Companies input: ${companiesFile}`);
    logPivot(`Scraped financials input (JSONL): ${scrapedFinancialsFile}`); // Indicate format
    logPivot(`Output file: ${outputFile}`);

    try {
        // --- Load Data ---
        logPivot(`Reading input data...`);
        let companiesData, scrapedFinancialsData;
        try {
            const companiesRaw = await fs.promises.readFile(companiesFile, "utf-8");
            companiesData = JSON.parse(companiesRaw);
            // Read and parse JSONL
            const scrapedFinancialsRaw = await fs.promises.readFile(scrapedFinancialsFile, "utf-8");
            scrapedFinancialsData = parseJsonl(scrapedFinancialsRaw); // Use parser function
        } catch (readErr) {
            logPivot(`❌ Error reading input files: ${readErr.message}`);
             if (readErr.path) {
                 logPivot(`Failed file: ${readErr.path}`);
             }
            return false; // Indicate failure
        }

        if (!Array.isArray(companiesData)) {
            throw new Error(`${companiesFile} does not contain a valid JSON array.`);
        }
         if (!Array.isArray(scrapedFinancialsData)) {
            throw new Error(`${scrapedFinancialsFile} does not contain a valid JSON array.`);
        }
        logPivot(`Loaded ${companiesData.length} companies and ${scrapedFinancialsData.length} scraped funding rounds from JSONL.`);


        // --- Group Scraped Rounds and Find Max ---
        logPivot("Grouping scraped rounds by permalink and finding max rounds...");
        const roundsMap = new Map();
        let maxRounds = 0;
        for (const round of scrapedFinancialsData) {
            const orgPermalink = round["Organization Permalink"];
            if (!orgPermalink) continue;
            if (!roundsMap.has(orgPermalink)) {
                roundsMap.set(orgPermalink, []);
            }
            roundsMap.get(orgPermalink).push(round);
            if (roundsMap.get(orgPermalink).length > maxRounds) {
                maxRounds = roundsMap.get(orgPermalink).length;
            }
        }
        logPivot(`Grouped rounds for ${roundsMap.size} companies. Max rounds: ${maxRounds}`);


        // --- Create Wide Data preserving company order ---
        logPivot("Creating wide format data, preserving company order...");
        const wideData = [];
        const companyFieldsToKeep = [ /* ... as before ... */ ];
        const roundFieldsToPivot = {
            "Date": "Announced Date",
            "Name": "Transaction Name",
            "InvestorsCount": "Number of Investors",
            "Sum": "Money Raised",
            "LeadInvestors": "Lead Investors"
        };

        for (const companyInfo of companiesData) {
            const companyPermalink = companyInfo["Organization Permalink"];
            const companyRounds = roundsMap.get(companyPermalink) || [];
            const companyRow = {};

            for (const field of companyFieldsToKeep) {
                companyRow[field] = companyInfo[field] ?? null;
            }

            companyRounds.sort((a, b) => {
                const dateA = new Date(a["Announced Date"]);
                const dateB = new Date(b["Announced Date"]);
                const timeA = !isNaN(dateA.getTime()) ? dateA.getTime() : Infinity;
                const timeB = !isNaN(dateB.getTime()) ? dateB.getTime() : Infinity;
                return timeA - timeB;
            });

            for (let i = 0; i < maxRounds; i++) {
                const round = companyRounds[i];
                for (const [suffix, sourceField] of Object.entries(roundFieldsToPivot)) {
                     const colName = `Round ${i + 1}_${suffix}`;
                     companyRow[colName] = round ? (round[sourceField] ?? null) : null;
                }
            }
            wideData.push(companyRow);
        }

        logPivot(`Created ${wideData.length} rows for wide format.`);

        // --- Save Output ---
        logPivot(`Saving wide format data to ${outputFile}...`);
        await fs.promises.writeFile(outputFile, JSON.stringify(wideData, null, 2), "utf-8");
        logPivot(`✅ Wide format data successfully saved.`);
        return true; // Indicate success

    } catch (error) {
        logPivot(`❌ An error occurred during pivoting: ${error.message}`);
        // console.error(error.stack);
        return false; // Indicate failure
    }
}

// --- Export the main function ---
module.exports = {
    runPivoting
};

// --- REMOVE direct execution block --- 