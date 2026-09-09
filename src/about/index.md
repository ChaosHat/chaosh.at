---
hold: false
---
Hi, I'm ChaosHat, or more commonly Hat, or *more* commonly (but not as much on the internet) Mike. ChaosHat is a name so old I don't even totally remember where it came from. I'm pretty sure it was a randomly generated Rock Band name, or gamertag thing?

I love rpgs, crpgs, jrpgs, tactical ones, but I like a lot of other stuff too. The first game I remember being hype with anticipation for was Baldur's Gate 2. I remember my dad trying to trick me that Christmas by wrapping it in a bigger box and a bag of flour to disguise the size and weight, and then duct taping it to make it harder. I made him pay for that decision, I grabbed a knife and flour went everywhere. 

I'm {{ age }} years old, also a dad to two beautiful little girls, I like homelab stuff and sports (basically every Chicago team if you were wondering). 
## The site
This site is a place for me to write about games I play, why I like, or don't like them and just try to sit and be reflective and analyze things and why they make me feel that way. And also it's just fun to write, to think, to flex these kinds of creative, analytical, and writing muscles I don't necessarily get to in daily life. 

I like all kinds of games, video, board, ttrpgs, but I mostly expect to write about video ones. I might write about other stuff but that'll be sporadic. 

The idea was to keep a daily running log of thoughts as I played to return to when I was done and ready to write so I wouldn't forget things and then I thought that might be interesting in its own right. So now you can experience the highs and lows, my initial impressions and how they change. My more structured pieces are called Deep Thoughts because ultimately I'm a Jack Handey fan. 

A good starting point is the canon, that's kind of the quick get to know you gaming business card, here's ten games I really like and describe what I like and where I'm at. Favorites are the games that are basically canon adjacent, I'll return to them and I really love them but they didn't quite make it for a variety of reasons. I'm not trying to make reviews or anything, it's just how I feel. Disliked games aren't a statement of quality (or lack thereof), it's just not for me! 

The auroras thing kind of just happened. I started making kind of an 8 bit sunset thing and figured that was a bit played. I was playing FFVII Remake and was inspired by something lifestream-y and thought that looked like an aurora, and those are cool. They're unique to each day and everything that's posted remains the aurora header from the day it was made. 
## How it's built
I write everything in Obsidian, in one folder of my vault. A daily post is a note named for the day. Each `##` heading in it is a game or a board game, and the site collects every heading onto that game's own page, oldest first, so the page for a game is every paragraph I've ever written under its name. Nothing gets copied or filed by hand, and it's retroactive: register a game today and everything I wrote about it last spring is already on its page. Longer pieces are essays, filed to whatever they cite.

At 2am a timer on my desktop runs a Python script that checks what's ready, copies it into a public git repo, and pushes. GitHub Actions builds the site with Eleventy and serves it from GitHub Pages. The skies are SVGs seeded by the date, so each day, each game and the site button wear their own colors. The type is Silkscreen for the chrome and Alegreya Sans for the prose. There's no JavaScript on the page and no analytics.

The plumbing was built with Claude Code; the words are mine. The source is at [github.com/ChaosHat/chaosh.at](https://github.com/ChaosHat/chaosh.at).
## Contact
- email is me at chaosh.at
- [bluesky](https://bsky.app/profile/chaosh.at)