const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

// --- Logging Utility ---
function logCsv(message) {
    const time = new Date().toISOString();
    console.log(`[${time}] [CSV_CONVERT] ${message}`);
}

// --- CSV Escaping Helper ---
const escapeCsvValue = (value) => {
    if (value === null || value === undefined) return "";
    const str = value.toString().replace(/"/g, '""');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str}"`;
    }
    return str;
};

// --- Main Exportable Function ---
// Note: type parameter is no longer needed as caller specifies files/sheet name
async function runConversion(inputFile, csvOutputFile, xlsxOutputFile, sheetName = "Sheet1") {
    logCsv(`Starting CSV/XLSX conversion...`);
    logCsv(`Input file: ${inputFile}`);
    logCsv(`CSV output: ${csvOutputFile}`);
    logCsv(`XLSX output: ${xlsxOutputFile}`);
    logCsv(`Sheet name: ${sheetName}`);

    try {
        // --- Load JSON Data ---
        logCsv(`Reading from: ${inputFile}`);
        let data;
        try {
            const rawData = await fs.promises.readFile(inputFile, "utf-8");
            data = JSON.parse(rawData);
        } catch (readErr) {
             logCsv(`❌ Error reading input file ${inputFile}: ${readErr.message}`);
             return false; // Indicate failure
        }


        if (!Array.isArray(data)) {
            throw new Error("Input data is not a JSON array.");
        }

        if (data.length === 0) {
            logCsv("⚠️ No data found in input file to convert. Skipping output generation.");
             // No need to create empty files unless specifically required
            return true; // Considered successful as there's nothing to convert
        }

        // --- CSV Conversion ---
        // Determine headers from the first object to handle potentially sparse wide format
        const fields = Object.keys(data[0] || {});
        if (fields.length === 0) {
            logCsv("⚠️ Data array contains empty objects. Skipping output generation.");
             return true;
        }


        logCsv(`Generating CSV: ${csvOutputFile}`);
        const csvHeader = fields.map(escapeCsvValue).join(",");
        const csvRows = data.map(entry =>
            fields.map(field => escapeCsvValue(entry[field])).join(",")
        );
        const csvContent = [csvHeader, ...csvRows].join("\n");

        await fs.promises.writeFile(csvOutputFile, csvContent, "utf-8");
        logCsv(`✅ CSV successfully saved: ${csvOutputFile}`);

        // --- XLSX Conversion ---
        logCsv(`Generating XLSX: ${xlsxOutputFile}`);
        // json_to_sheet handles potentially missing fields correctly
        const worksheet = XLSX.utils.json_to_sheet(data, { header: fields });
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

        // Use writeFile (synchronous) or write (async requires buffer handling)
        // Sticking with writeFile for simplicity as it's often used in examples
        XLSX.writeFile(workbook, xlsxOutputFile);
        logCsv(`✅ Excel file successfully saved: ${xlsxOutputFile}`);
        return true; // Indicate success

    } catch (error) {
        logCsv(`❌ An error occurred during conversion: ${error.message}`);
        // console.error(error.stack);
        return false; // Indicate failure
    }
}

// --- Export the main function ---
module.exports = {
    runConversion
};

// --- REMOVE direct execution block ---
// const args = process.argv.slice(2);
// ... argument parsing ...
// ... file/sheet name determination ...
// ... main execution try-catch ... 