const fs = require("fs");
const puppeteer = require("puppeteer");

// --- Logging Utility ---
function logScraper(message) {
    const time = new Date().toISOString();
    console.log(`[${time}] [FIN_SCRAPER] ${message}`);
}

// --- Main Exportable Function ---
async function scrapeFinancialDetails(companiesFilePath, cookiesFilePath, outputFile, options = {}) {
    logScraper("Starting financial details scraping process (with incremental saving)...");
    logScraper(`Companies input: ${companiesFilePath}`);
    logScraper(`Cookies input: ${cookiesFilePath}`);
    logScraper(`Output file (JSONL): ${outputFile}`);

    const { scraperPauseMs = 2000, pageTimeoutMs = 60000 } = options;

    let browser = null;
    let companiesData;
    let cookies;
    let overallSuccess = true;

    try {
        // --- Load prerequisites ---
        logScraper("Loading companies data...");
        try {
            const companiesRaw = await fs.promises.readFile(companiesFilePath, "utf-8");
            companiesData = JSON.parse(companiesRaw);
            if (!Array.isArray(companiesData)) throw new Error("Companies data is not an array.");
        } catch (err) {
            logScraper(`❌ Error reading companies file ${companiesFilePath}: ${err.message}`);
            return false;
        }
        logScraper(`Loaded ${companiesData.length} companies.`);

        logScraper("Loading cookies...");
        try {
            const cookiesRaw = await fs.promises.readFile(cookiesFilePath, "utf-8");
            cookies = JSON.parse(cookiesRaw);
            if (!Array.isArray(cookies)) throw new Error("Cookies data is not an array.");
        } catch (err) {
            logScraper(`❌ Error reading cookies file ${cookiesFilePath}: ${err.message}`);
            return false;
        }
        logScraper("Cookies loaded.");

        // --- Clear/Initialize Output File ---
        logScraper(`Initializing output file: ${outputFile}`);
        try {
            await fs.promises.writeFile(outputFile, '', 'utf-8');
        } catch (err) {
            logScraper(`❌ Error initializing output file ${outputFile}: ${err.message}`);
            return false;
        }

        // --- Launch Puppeteer ---
        logScraper("Launching Puppeteer browser...");
        browser = await puppeteer.launch({ headless: false });
        logScraper("Browser launched.");

        // --- Iterate through companies ---
        for (let i = 0; i < companiesData.length; i++) {
            const companyInfo = companiesData[i];
            const permalink = companyInfo["Organization Permalink"];
            const companyName = companyInfo["Organization Name"];
            let companySuccess = false;

            if (!permalink) {
                logScraper(`⚠️ Skipping company #${i + 1} ("${companyName}") due to missing permalink.`);
                continue;
            }

            const url = `https://www.crunchbase.com/organization/${permalink}/financial_details`;
            logScraper(`Processing company #${i + 1}/${companiesData.length}: ${companyName} (${permalink})...`);
            logScraper(`Navigating to: ${url}`);

            let page = null;
            try {
                page = await browser.newPage();
                await page.setCookie(...cookies);
                await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.127 Safari/537.36');
                await page.setDefaultNavigationTimeout(pageTimeoutMs);
                await page.setDefaultTimeout(pageTimeoutMs);

                await page.goto(url, { waitUntil: 'networkidle2' });
                logScraper("Page loaded.");

                // --- Scrape the table ---
                const tableSelector = '#funding_rounds > section > div > tile-table > div > table';
                logScraper(`Waiting for table selector: "${tableSelector}"`);
                await page.waitForSelector(tableSelector, { timeout: 30000 });
                logScraper("Table found. Scraping rows...");

                const roundsOnPage = await page.$$eval(`${tableSelector} tbody tr`, (rows) => {
                    const extractedData = [];
                    rows.forEach(row => {
                        const cells = row.querySelectorAll('td');
                        if (cells.length >= 5) {
                            const getText = (element) => element ? element.innerText.trim() : null;
                            const getHref = (element) => element ? element.href : null;

                            const announcedDateEl = cells[0]?.querySelector('span.field-type-date');
                            const transactionLinkEl = cells[1]?.querySelector('a.component--field-formatter');
                            const numInvestorsEl = cells[2]?.querySelector('a.field-type-integer');
                            const moneyRaisedEl = cells[3]?.querySelector('span.field-type-money');
                            const leadInvestorsEls = cells[4]?.querySelectorAll('identifier-multi-formatter a');

                            const leadInvestors = leadInvestorsEls ? Array.from(leadInvestorsEls).map(el => getText(el)).filter(Boolean).join(', ') : null;

                            extractedData.push({
                                "Announced Date": announcedDateEl ? (announcedDateEl.title || getText(announcedDateEl)) : null,
                                "Transaction Name": getText(transactionLinkEl),
                                "Transaction Link": getHref(transactionLinkEl),
                                "Number of Investors": getText(numInvestorsEl),
                                "Money Raised": moneyRaisedEl ? (moneyRaisedEl.title || getText(moneyRaisedEl)) : null,
                                "Lead Investors": leadInvestors
                            });
                        }
                    });
                    return extractedData;
                });

                logScraper(`Scraped ${roundsOnPage.length} rounds for ${companyName}.`);

                if (roundsOnPage.length > 0) {
                    const companyRounds = roundsOnPage.map(round => ({
                        "Organization Permalink": permalink,
                        "Organization Name": companyName,
                        ...round
                    }));

                    const linesToAppend = companyRounds.map(r => JSON.stringify(r)).join('\n') + '\n';
                    await fs.promises.appendFile(outputFile, linesToAppend, 'utf-8');
                    logScraper(`Appended ${companyRounds.length} rounds to ${outputFile}.`);
                }
                companySuccess = true;

            } catch (err) {
                logScraper(`❌ Error processing ${companyName} (${url}): ${err.message}`);
                overallSuccess = false;
            } finally {
                if (page) {
                    await page.close();
                    logScraper("Page closed.");
                }
                if (i < companiesData.length - 1) {
                    logScraper(`⏸️ Pausing for ${scraperPauseMs / 1000} seconds...`);
                    await new Promise(resolve => setTimeout(resolve, scraperPauseMs));
                }
            }
        }

        logScraper("Finished processing all companies.");
        return overallSuccess;

    } catch (error) {
        logScraper(`❌ Critical error during financial scraping setup or teardown: ${error.message}`);
        return false;
    } finally {
        if (browser) {
            await browser.close();
            logScraper("Browser closed.");
        }
    }
}

module.exports = {
    scrapeFinancialDetails
}; 