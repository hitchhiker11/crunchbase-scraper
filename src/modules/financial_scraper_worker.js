const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const puppeteer = require('puppeteer');

// --- Worker Logging Utility ---
// Prefix logs with Worker ID for clarity
const workerId = workerData.workerId || 'W?';
function logWorker(message) {
    const time = new Date().toISOString();
    console.log(`[${time}] [WORKER ${workerId}] ${message}`);
}

// --- Scraping Logic (similar to single-threaded version) ---
async function scrapeCompanyFinancials(page, companyInfo) {
    const permalink = companyInfo["Organization Permalink"];
    const companyName = companyInfo["Organization Name"];
    const url = `https://www.crunchbase.com/organization/${permalink}/financial_details`;

    logWorker(`Navigating to: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2' });
    logWorker(`Page loaded for ${companyName}.`);

    const tableSelector = 'company-funding tile-table table';
    logWorker(`Waiting for table selector: "${tableSelector}"`);
    await page.waitForSelector(tableSelector, { timeout: 30000 });
    logWorker(`Table found for ${companyName}. Scraping rows...`);

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

    logWorker(`Scraped ${roundsOnPage.length} rounds for ${companyName}.`);

    // Return data including company context
    return roundsOnPage.map(round => ({
        "Organization Permalink": permalink,
        "Organization Name": companyName,
        ...round
    }));
}


// --- Main Worker Function ---
async function runWorker() {
    const { companiesChunk, cookiesFilePath, options } = workerData;
    const { scraperPauseMs = 2000, pageTimeoutMs = 60000 } = options;
    logWorker(`Received ${companiesChunk.length} companies to process.`);

    let cookies;
    try {
        logWorker(`Loading cookies from ${cookiesFilePath}`);
        const cookiesRaw = fs.readFileSync(cookiesFilePath, 'utf-8'); // Use sync read in worker startup
        cookies = JSON.parse(cookiesRaw);
        if (!Array.isArray(cookies)) throw new Error("Cookies data is not an array.");
        logWorker("Cookies loaded.");
    } catch (err) {
        logWorker(`❌ Error loading cookies: ${err.message}`);
        parentPort.postMessage({ type: 'error', payload: { error: `Failed to load cookies: ${err.message}` } });
        return; // Stop worker if cookies fail
    }

    let browser = null;
    try {
        logWorker("Launching Puppeteer browser...");
        browser = await puppeteer.launch({ headless: true });
        logWorker("Browser launched.");

        for (let i = 0; i < companiesChunk.length; i++) {
            const companyInfo = companiesChunk[i];
            const companyName = companyInfo["Organization Name"] || 'Unknown Company';
            const permalink = companyInfo["Organization Permalink"];
            logWorker(`Processing company ${i + 1}/${companiesChunk.length}: ${companyName}...`);

            let page = null;
            try {
                page = await browser.newPage();
                await page.setCookie(...cookies);
                await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.127 Safari/537.36');
                await page.setDefaultNavigationTimeout(pageTimeoutMs);
                await page.setDefaultTimeout(pageTimeoutMs);

                const companyRounds = await scrapeCompanyFinancials(page, companyInfo);

                // Send scraped data back to the main thread
                if (companyRounds.length > 0) {
                    parentPort.postMessage({ type: 'data', payload: companyRounds });
                }

            } catch (err) {
                logWorker(`❌ Error processing ${companyName} (Permalink: ${permalink}): ${err.message}`);
                // Send error details back to the main thread
                parentPort.postMessage({ type: 'error', payload: { permalink: permalink, name: companyName, error: err.message } });
                // Continue to the next company in the chunk
            } finally {
                if (page) {
                    await page.close();
                    logWorker(`Page closed for ${companyName}.`);
                }
                 // Pause before the next company in this worker
                 if (i < companiesChunk.length - 1) {
                    logWorker(`Worker pausing for ${scraperPauseMs / 1000} seconds...`);
                    await new Promise(resolve => setTimeout(resolve, scraperPauseMs));
                 }
            }
        } // End company loop for this worker

        logWorker("Finished processing all assigned companies.");

    } catch (err) {
        logWorker(`❌ Critical worker error: ${err.message}`);
        parentPort.postMessage({ type: 'error', payload: { error: `Critical worker error: ${err.message}` } });
    } finally {
        if (browser) {
            await browser.close();
            logWorker("Browser closed.");
        }
        // Signal that this worker is done
        parentPort.postMessage({ type: 'done' });
    }
}

// --- Start the worker ---
runWorker(); 