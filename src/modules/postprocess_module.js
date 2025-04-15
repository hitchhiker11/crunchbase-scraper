const fs = require("fs");

// --- Logging Utility ---
// Keep local, separate from scraper/pipeline logs
function logPostprocess(message) {
    const time = new Date().toISOString();
    console.log(`[${time}] [POSTPROCESS] ${message}`);
}

// --- Helper Functions (getVal, joinArrayValues) ---
// Keep these internal as they are used by processing functions
const getVal = (obj, keyString, defaultValue = null) => {
  const keys = keyString.split('.');
  let current = obj;
  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return defaultValue;
    }
    current = current[key];
  }
  return current ?? defaultValue;
};

const joinArrayValues = (arr, key = 'value', separator = ", ") => {
  if (!Array.isArray(arr)) return "";
  return arr.map(item => getVal(item, key, '')).filter(Boolean).join(separator);
};

// --- Processing Logic Functions (Keep internal or export if needed elsewhere) ---
function processCompanies(data) {
  return data.map(({ properties }) => ({
    "Organization Name": getVal(properties, "identifier.value"),
    "Organization Permalink": getVal(properties, "identifier.permalink"),
    "Industries": joinArrayValues(properties.categories),
    "Headquarters Location": joinArrayValues((properties.location_identifiers || []).filter(loc => loc.location_type === "city")),
    "Description": getVal(properties, "short_description"),
    "CB Rank (Organization)": getVal(properties, "rank_org"),
    "Stage": getVal(properties, "funding_stage"),
    "CB Rank (Company)": getVal(properties, "rank_org_company"),
    "Founded Date": getVal(properties.founded_on, "value"),
    "Investor Type": getVal(properties, "investor_type"),
    "Investment Stage": getVal(properties, "investor_stage"),
    "Number of Investments": getVal(properties, "num_investments_funding_rounds"),
    "Number of Funding Rounds": getVal(properties, "num_funding_rounds"),
    "Funding Status": getVal(properties.funding_total, "value_usd") ? "Raised" : "N/A",
    "Last Funding Type": getVal(properties, "last_funding_type"),
    "Total Funding Amount": getVal(properties.funding_total, "value_usd"),
    "Last Funding Amount": getVal(properties.last_funding_total, "value_usd"),
    "Number Of Investors": getVal(properties, "num_investors"),
    "Revenue Range": getVal(properties, "revenue_range")
  }));
}

function processFundingRounds(data) {
    return data.map(({ properties }) => ({
        "Funding Round UUID": getVal(properties, "uuid"),
        "Organization Name": getVal(properties, "funded_organization_identifier.value"),
        "Organization Permalink": getVal(properties, "funded_organization_identifier.permalink"),
        "Organization Description": getVal(properties, "funded_organization_description"),
        "Organization Industries": joinArrayValues(properties.funded_organization_categories),
        "Organization Location": joinArrayValues(properties.funded_organization_location),
        "Organization Website": getVal(properties, "funded_organization_website.value"),
        "Org Num Funding Rounds": getVal(properties, "funded_organization_num_funding_rounds"),
        "Org Funding Total (USD)": getVal(properties, "funded_organization_funding_total.value_usd"),
        "Org Funding Stage": getVal(properties, "funded_organization_funding_stage"),
        "Org Revenue Range": getVal(properties, "funded_organization_revenue_range"),
        "Org Diversity Spotlights": joinArrayValues(properties.funded_organization_diversity_spotlights),
        "Investment Type": getVal(properties, "investment_type"),
        "Investment Stage": joinArrayValues(properties.investment_stage),
        "Money Raised (USD)": getVal(properties, "money_raised.value_usd"),
        "Announced Date": getVal(properties.announced_on, "value"),
        "Number of Investors": getVal(properties, "num_investors"),
        "Number of Partners": getVal(properties, "num_partners"),
        "Lead Investors": joinArrayValues(properties.lead_investor_identifiers, 'value'),
        "Investors": joinArrayValues(properties.investor_identifiers, 'value'),
        "Is Equity": getVal(properties, "is_equity"),
        "Sentiment": getVal(properties, "sentiment"),
        "Pre-Money Valuation (USD)": getVal(properties, "pre_money_valuation.value_usd"),
        "Rank (Funding Round)": getVal(properties, "rank_funding_round"),
    }));
}

// --- Main Exportable Function ---
async function runPostprocessing(type, inputFile, outputFile) {
    logPostprocess(`Starting postprocessing for type: ${type}`);
    logPostprocess(`Input file: ${inputFile}`);
    logPostprocess(`Output file: ${outputFile}`);

    let processingFunction;
    if (type === 'companies') {
        processingFunction = processCompanies;
    } else if (type === 'fundingRounds') {
        processingFunction = processFundingRounds;
    } else {
        logPostprocess(`❌ Unknown processing type: '${type}'.`);
        return false; // Indicate failure
    }

    try {
        // Check if input file exists (use async version)
         try {
             await fs.promises.access(inputFile, fs.constants.R_OK);
         } catch (readErr) {
             logPostprocess(`❌ Error: Input file not found or not readable: ${inputFile}`);
             return false;
         }


        logPostprocess(`Reading from: ${inputFile}`);
        const rawData = await fs.promises.readFile(inputFile, "utf-8");
        const data = JSON.parse(rawData);

        if (!Array.isArray(data)) {
            throw new Error("Input data is not a JSON array.");
        }

        if (data.length === 0) {
            logPostprocess("⚠️ Input file is empty. No data to process.");
            // Create an empty output file
            await fs.promises.writeFile(outputFile, JSON.stringify([], null, 2), "utf-8");
            logPostprocess(`✅ Saved empty processed data to ${outputFile}`);
        } else {
            logPostprocess(`Processing ${data.length} entries...`);
            const processedData = processingFunction(data); // This is synchronous
            await fs.promises.writeFile(outputFile, JSON.stringify(processedData, null, 2), "utf-8");
            logPostprocess(`✅ Saved processed data to ${outputFile}`);
        }
        return true; // Indicate success

    } catch (error) {
        logPostprocess(`❌ An error occurred during processing: ${error.message}`);
        // Optional: Log stack trace for debugging
        // console.error(error.stack);
        return false; // Indicate failure
    }
}

// --- Export the main function ---
module.exports = {
    runPostprocessing
};

// --- REMOVE direct execution block ---
// const args = process.argv.slice(2);
// ... argument parsing ...
// ... main execution try-catch ... 