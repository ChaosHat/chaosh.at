---
hold: false
---
I write everything in Obsidian, in one folder of my vault. A daily post is a note named for the day. Each `##` heading in it is a game or a board game, and the site collects every heading onto that game's own page, oldest first, so the page for a game is every paragraph I've ever written under its name. Nothing gets copied or filed by hand, and it's retroactive: register a game today and everything I wrote about it last spring is already on its page. Longer pieces are essays, filed to whatever they cite.

At 2am a timer on my desktop runs a Python script that checks what's ready, copies it into a public git repo, and pushes. GitHub Actions builds the site with Eleventy and serves it from Cloudflare Pages. The skies are pixel art drawn at build time and seeded by the date, so each day, each game and the site button wear their own colors. The type is Pixel Operator (tightened a pixel, on its exact grid) for the chrome and Alegreya Sans for the prose. The only JavaScript on the page opens an image bigger when you click it and scrolls the now-playing row when it runs long, and there are no analytics.

Images are sourced from SteamGrid DB for games, BoardGameGeek for board games, and TMDB for movies/shows. This product uses the [TMDB](https://www.themoviedb.org) API but is not endorsed or certified by TMDB.

The source is at [github.com/ChaosHat/chaosh.at](https://github.com/ChaosHat/chaosh.at). I decided to start posting some of the behind the scenes updates and reasoning which you can follow here at the [Aurora Watch](/s/sausage/). All the words are my ideas, my thoughts and feelings, and written by me! The code is different, it's mostly written by Claude Code working under my vision and goals for how the site should look. 
