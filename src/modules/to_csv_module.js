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

        // --- Determine all possible headers ---
        logCsv("Determining headers from all data objects...");
        const allKeys = new Set();
        data.forEach(obj => {
            if (obj && typeof obj === 'object') { // Ensure obj is an object
                Object.keys(obj).forEach(key => allKeys.add(key));
            }
        });

        if (allKeys.size === 0) {
             logCsv("⚠️ No data keys found in input objects. Skipping output generation.");
             return true;
        }


        // Sort keys: Company fields first alphabetically, then Round fields numerically/alphabetically
        const fields = Array.from(allKeys).sort((a, b) => {
            const isARound = a.startsWith('Round ');
            const isBRound = b.startsWith('Round ');

            // Rule 1: Non-round fields come before round fields
            if (!isARound && isBRound) return -1;
            if (isARound && !isBRound) return 1;

            // Rule 2: Sort non-round fields alphabetically
            if (!isARound && !isBRound) {
                return a.localeCompare(b);
            }

            // Rule 3: Sort round fields by round number, then by suffix
            if (isARound && isBRound) {
                const matchA = a.match(/Round (\d+)_(.+)/);
                const matchB = b.match(/Round (\d+)_(.+)/);

                if (matchA && matchB) {
                    const numA = parseInt(matchA[1]);
                    const suffixA = matchA[2];
                    const numB = parseInt(matchB[1]);
                    const suffixB = matchB[2];

                    if (numA !== numB) {
                        return numA - numB; // Sort by round number first
                    }
                    return suffixA.localeCompare(suffixB); // Then by suffix name
                }
                // Fallback sort if regex fails (shouldn't happen with correct format)
                return a.localeCompare(b);
            }

            // Should not be reached, but provide default sort
            return a.localeCompare(b);
        });
        logCsv(`Determined ${fields.length} headers.`);
        // logCsv(`Headers order: ${fields.join(', ')}`); // Optional: log header order for debugging


        // --- CSV Conversion ---
        logCsv(`Generating CSV: ${csvOutputFile}`);
        const csvHeader = fields.map(escapeCsvValue).join(",");
        const csvRows = data.map(entry =>
            // Ensure entry is an object before accessing fields
            fields.map(field => escapeCsvValue(entry && typeof entry === 'object' ? entry[field] : null)).join(",")
        );
        const csvContent = [csvHeader, ...csvRows].join("\n");

        await fs.promises.writeFile(csvOutputFile, csvContent, "utf-8");
        logCsv(`✅ CSV successfully saved: ${csvOutputFile}`);

        // --- XLSX Conversion ---
        logCsv(`Generating XLSX: ${xlsxOutputFile}`);
        // Provide explicit header order to json_to_sheet
        const worksheet = XLSX.utils.json_to_sheet(data, { header: fields });
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

        XLSX.writeFile(workbook, xlsxOutputFile);
        logCsv(`✅ Excel file successfully saved: ${xlsxOutputFile}`);
        return true;

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