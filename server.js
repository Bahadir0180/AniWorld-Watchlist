const express = require('express');
const { chromium } = require('playwright');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static('public'));
app.use(express.static(path.join(__dirname, 'public')));

// ----------------------------------------------------------------
// 1. Einzelnen Anime aktualisieren (Playwright)
// ----------------------------------------------------------------
app.post('/api/fetch-single-anime', async (req, res) => {
    let { email, password, url } = req.body;

    if (!email || !password || !url) {
        return res.status(400).json({ error: 'E-Mail, Passwort und URL erforderlich.' });
    }

    if (!url.startsWith('http')) {
        url = 'https://aniworld.to' + (url.startsWith('/') ? '' : '/') + url;
    }

    let browser;
    try {
        browser = await chromium.launch({
            headless: false,
            channel: 'msedge',
            slowMo: 50,
            args: ['--ignore-certificate-errors', '--ignore-certificate-errors-spki-list', '--no-sandbox']
        });

        const context = await browser.newContext();
        const page = await context.newPage();

        // 1. Einloggen
        console.log('Navigiere zum Login...');
        await page.goto('https://aniworld.to/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.fill('input[name="email"]', email);
        await page.fill('input[name="password"]', password);
        await page.click('input[value="Einloggen"]');
        await page.waitForTimeout(3000);

        // 2. Ziel-URL aufrufen
        console.log(`Navigiere zu Ziel-URL: ${url}`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

        // 3. Unterseiten (Staffeln/Filme) ermitteln
        const subPageLinks = await page.evaluate(() => {
            const links = [];
            const seasonUl = document.querySelector('#stream ul:nth-of-type(1)');
            if (seasonUl) {
                seasonUl.querySelectorAll('li a').forEach(a => {
                    const href = a.getAttribute('href') || '';
                    if (href && !href.startsWith('javascript:') && (href.includes('/staffel-') || href.includes('/filme'))) {
                        links.push({ text: a.innerText.trim(), href: a.href });
                    }
                });
            }
            return links;
        });

        const evaluateEpisodesOnly = () => {
            const epUl = document.querySelector('#stream ul:nth-of-type(2)');
            if (!epUl) return { total: 0, watched: 0 };

            const epLinks = Array.from(epUl.querySelectorAll('li a'));
            const episodeButtons = epLinks.filter(el => {
                const text = el.innerText.trim();
                const href = el.getAttribute('href') || '';
                return /^\d+$/.test(text) || href.includes('/episode-');
            });

            let total = episodeButtons.length;
            let watched = 0;

            episodeButtons.forEach(el => {
                if (el.classList.contains('seen') || el.classList.contains('active') || el.querySelector('.fa-check, .svg-inline--fa')) {
                    watched++;
                }
            });

            return { total, watched };
        };

        const seasonsData = [];
        let totalEpisodesCount = 0;
        let watchedEpisodesCount = 0;

        if (subPageLinks.length > 0) {
            for (const sub of subPageLinks) {
                await page.goto(sub.href, { waitUntil: 'domcontentloaded', timeout: 15000 });
                const pageStats = await page.evaluate(evaluateEpisodesOnly);

                totalEpisodesCount += pageStats.total;
                watchedEpisodesCount += pageStats.watched;

                let status = 'open';
                if (pageStats.watched === pageStats.total && pageStats.total > 0) status = 'completed';
                else if (pageStats.watched > 0) status = 'in_progress';

                seasonsData.push({
                    name: sub.text,
                    total: pageStats.total,
                    watched: pageStats.watched,
                    status
                });
            }
        } else {
            const pageStats = await page.evaluate(evaluateEpisodesOnly);
            totalEpisodesCount = pageStats.total;
            watchedEpisodesCount = pageStats.watched;

            let status = 'open';
            if (pageStats.watched === pageStats.total && pageStats.total > 0) status = 'completed';
            else if (pageStats.watched > 0) status = 'in_progress';

            seasonsData.push({
                name: 'Staffel 1',
                total: pageStats.total,
                watched: pageStats.watched,
                status
            });
        }

        const isMovie = url.includes('/filme') || seasonsData.some(s => s.name.toLowerCase().includes('film'));
        const unitLabel = isMovie ? 'Film(e)' : 'Folgen';
        const progressText = `${watchedEpisodesCount} von ${totalEpisodesCount} ${unitLabel} gesehen`;

        await browser.close();
        console.log('Einzel-Scrape erfolgreich:', progressText);

        return res.json({
            success: true,
            anime: {
                progressText,
                seasons: seasonsData,
                isMovie
            }
        });

    } catch (error) {
        if (browser) await browser.close();
        console.error('Detaillierter Fehler beim Einzel-Scrape:', error.message);
        return res.status(500).json({ error: `Scraping fehlgeschlagen: ${error.message}` });
    }
});

// ----------------------------------------------------------------
// 2. Gesamte Watchlist aktualisieren (Playwright)
// ----------------------------------------------------------------
app.post('/api/fetch-watchlist', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'E-Mail und Passwort erforderlich' });
    }

    let browser;
    try {
        console.log('Starte Browser...');
        browser = await chromium.launch({
            headless: false,
            channel: 'msedge',
            slowMo: 50,
            args: ['--ignore-certificate-errors', '--ignore-certificate-errors-spki-list', '--no-sandbox']
        });
        const context = await browser.newContext();
        const page = await context.newPage();

        console.log('Navigiere zum Login...');
        await page.goto('https://aniworld.to/login', { waitUntil: 'domcontentloaded', timeout: 30000 });

        console.log('Fülle Login-Daten aus...');
        await page.fill('input[name="email"]', email);
        await page.fill('input[name="password"]', password);
        await page.click('input[value="Einloggen"]');
        await page.waitForTimeout(4000);

        console.log('Rufe Watchlist auf...');
        await page.goto('https://aniworld.to/account/watchlist', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(2000);

        const animeList = await page.evaluate(() => {
            const items = [];
            document.querySelectorAll('.seriesListContainer > div').forEach(el => {
                const linkElement = el.querySelector('a');
                const titleElement = el.querySelector('h3');
                const genreElement = el.querySelector('small');
                const imgElement = el.querySelector('img');

                if (titleElement && linkElement) {
                    const title = titleElement.childNodes[0]?.nodeValue?.trim() || titleElement.innerText.trim();
                    const link = linkElement.href;
                    const cover = imgElement ? imgElement.src : '';
                    const rawGenre = genreElement?.innerText.trim() || 'Unbekannt';
                    const genres = rawGenre.split(/[,/]/).map(g => g.trim()).filter(Boolean);

                    items.push({ title, link, cover, genres });
                }
            });
            return items;
        });

        console.log(`${animeList.length} Animes gefunden. Lade Details...`);

        const watchlistWithProgress = [];

        for (const anime of animeList) {
            console.log(`Prüfe Status für: ${anime.title}...`);
            await page.goto(anime.link, { waitUntil: 'domcontentloaded', timeout: 20000 });

            const subPageLinks = await page.evaluate(() => {
                const links = [];
                const seasonUl = document.querySelector('#stream ul:nth-of-type(1)');
                if (seasonUl) {
                    seasonUl.querySelectorAll('li a').forEach(a => {
                        const href = a.getAttribute('href') || '';
                        if (href && !href.startsWith('javascript:') && (href.includes('/staffel-') || href.includes('/filme'))) {
                            links.push({ text: a.innerText.trim(), href: a.href });
                        }
                    });
                }
                return links;
            });

            const seasonsData = [];
            let totalEpisodesCount = 0;
            let watchedEpisodesCount = 0;

            const evaluateEpisodesOnly = () => {
                const epUl = document.querySelector('#stream ul:nth-of-type(2)');
                if (!epUl) return { total: 0, watched: 0 };

                const epLinks = Array.from(epUl.querySelectorAll('li a'));

                const episodeButtons = epLinks.filter(el => {
                    const text = el.innerText.trim();
                    const href = el.getAttribute('href') || '';
                    return /^\d+$/.test(text) || href.includes('/episode-');
                });

                let total = episodeButtons.length;
                let watched = 0;

                episodeButtons.forEach(el => {
                    if (el.classList.contains('seen') || el.classList.contains('active') || el.querySelector('.fa-check, .svg-inline--fa')) {
                        watched++;
                    }
                });

                return { total, watched };
            };

            if (subPageLinks.length > 0) {
                for (const sub of subPageLinks) {
                    await page.goto(sub.href, { waitUntil: 'domcontentloaded', timeout: 15000 });
                    const pageStats = await page.evaluate(evaluateEpisodesOnly);

                    totalEpisodesCount += pageStats.total;
                    watchedEpisodesCount += pageStats.watched;

                    let status = 'open';
                    if (pageStats.watched === pageStats.total && pageStats.total > 0) status = 'completed';
                    else if (pageStats.watched > 0) status = 'in_progress';

                    seasonsData.push({
                        name: sub.text,
                        total: pageStats.total,
                        watched: pageStats.watched,
                        status
                    });
                }
            } else {
                const pageStats = await page.evaluate(evaluateEpisodesOnly);
                totalEpisodesCount = pageStats.total;
                watchedEpisodesCount = pageStats.watched;

                let status = 'open';
                if (pageStats.watched === pageStats.total && pageStats.total > 0) status = 'completed';
                else if (pageStats.watched > 0) status = 'in_progress';

                seasonsData.push({
                    name: 'Staffel 1',
                    total: pageStats.total,
                    watched: pageStats.watched,
                    status
                });
            }

            const isMovie = anime.link.includes('/filme') || seasonsData.some(s => s.name.toLowerCase().includes('film'));
            const unitLabel = isMovie ? 'Film(e)' : 'Folgen';
            const progressText = `${watchedEpisodesCount} von ${totalEpisodesCount} ${unitLabel} gesehen`;

            watchlistWithProgress.push({
                ...anime,
                isMovie,
                progressText,
                seasons: seasonsData
            });
        }

        console.log('Fertig!');
        await browser.close();
        res.json({ success: true, watchlist: watchlistWithProgress });

    } catch (error) {
        if (browser) await browser.close();
        console.error('Fehler:', error.message);
        res.status(500).json({ error: 'Fehler: ' + error.message });
    }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(3000, () => {
    console.log('Server läuft auf Port 3000');
});
