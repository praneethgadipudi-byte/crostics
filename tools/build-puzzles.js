/*
 * Crostics puzzle builder  --  dev only, never shipped with the game.
 *
 * Run:  cscript //nologo tools\build-puzzles.js
 *
 * Written in ES3 JScript so it runs on Windows Script Host with no toolchain
 * installed. That means: no JSON global, no let/const, no array extras.
 *
 * What it does, for each of the five themes listed in SOURCES:
 *   1. reads the shared answer bank and the theme's source file
 *   2. searches the bank for a set of answers whose letters are covered by the
 *      quote's letters, leaving only the allowed slack
 *   3. assigns every answer letter to a concrete quote cell
 *   4. chooses which letters lose their index number
 *   5. scores difficulty on eight levers and asserts the ten puzzles climb
 *   6. writes the report and injects PACK_DATA into index.html
 *
 * Because a number identifies a letter rather than a position, difficulty is not
 * about how many cells there are. It is about how much of the quote can be
 * mapped once a letter is known, which is why the hidden letter choice and the
 * share of common letters and connecting words carry so much weight below.
 */

var fso = new ActiveXObject("Scripting.FileSystemObject");
var ROOT = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName));

var SOURCES = [
    "tools\\source-food.json",
    "tools\\source-space.json",
    "tools\\source-body.json",
    "tools\\source-ancient.json",
    "tools\\source-animals.json"
];

function readFile(rel) {
    var p = fso.BuildPath(ROOT, rel);
    if (!fso.FileExists(p)) throw new Error("missing file: " + rel);
    var s = fso.OpenTextFile(p, 1, false, 0);
    var t = s.AtEndOfStream ? "" : s.ReadAll();
    s.Close();
    return t;
}

function writeFile(rel, text) {
    var p = fso.BuildPath(ROOT, rel);
    var f = fso.CreateTextFile(p, true, false);
    f.Write(text);
    f.Close();
}

function parseJson(text) {
    return eval("(" + text + ")");
}

function say(msg) { WScript.Echo(msg); }

/* ---------------------------------------------------------------- json out */

function esc(s) {
    var out = "", i, c;
    for (i = 0; i < s.length; i++) {
        c = s.charAt(i);
        if (c === '"') out += '\\"';
        else if (c === "\\") out += "\\\\";
        else if (c === "\n") out += "\\n";
        else if (c === "\r") out += "\\r";
        else if (c === "\t") out += "\\t";
        else if (c < " ") out += "\\u" + ("000" + s.charCodeAt(i).toString(16)).slice(-4);
        else out += c;
    }
    return '"' + out + '"';
}

function dump(v) {
    var i, parts, k;
    if (v === null || typeof v === "undefined") return "null";
    if (typeof v === "number") return "" + v;
    if (typeof v === "boolean") return v ? "true" : "false";
    if (typeof v === "string") return esc(v);
    if (v instanceof Array) {
        parts = [];
        for (i = 0; i < v.length; i++) parts.push(dump(v[i]));
        return "[" + parts.join(",") + "]";
    }
    parts = [];
    for (k in v) if (v.hasOwnProperty(k)) parts.push(esc(k) + ":" + dump(v[k]));
    return "{" + parts.join(",") + "}";
}

/* ------------------------------------------------------------------ random */

function Rng(seed) {
    this.s = seed >>> 0;
}
Rng.prototype.next = function () {
    /* xorshift32, deterministic so a given seed always rebuilds the same pack */
    var x = this.s;
    x ^= x << 13; x = x >>> 0;
    x ^= x >>> 17;
    x ^= x << 5; x = x >>> 0;
    this.s = x;
    return x / 4294967296;
};
Rng.prototype.int = function (n) { return Math.floor(this.next() * n) % n; };
Rng.prototype.shuffle = function (arr) {
    var i, j, t;
    for (i = arr.length - 1; i > 0; i--) {
        j = this.int(i + 1);
        t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
};

/* ----------------------------------------------------------------- letters */

var A = 65;
var VOWELS = "AEIOU";
/* the letters that carry the most mapping power once one of them is cracked */
var COMMON = "ETAOINSHR";
/* short connecting words: scaffolding a solver leans on, so fewer is harder */
var STOPWORDS = ("THE A AN AND OR OF TO IN ON AT IT IS ARE WAS WERE BE BEEN AS BY " +
    "FOR FROM WITH THAT THIS THESE THOSE NOT NO SO BUT IF THEN THAN THEY THEM " +
    "ITS HIS HER OUR YOUR YOU WE I HE SHE ONE TWO ALL ANY CAN HAS HAVE HAD DO " +
    "DOES DID WILL WOULD MORE MOST OUT UP OVER UNDER INTO ABOUT AFTER BEFORE " +
    "STILL EVER NEVER ONCE ONLY EVEN JUST").split(" ");

function isAlpha(c) { return c >= "A" && c <= "Z"; }

function letterCells(quote) {
    /* every A-Z character of the quote becomes a cell */
    var cells = [], i, c, up = quote.toUpperCase();
    for (i = 0; i < up.length; i++) {
        c = up.charAt(i);
        if (isAlpha(c)) cells.push({ ch: c, at: i, code: c.charCodeAt(0) - A });
    }
    return cells;
}

function zeros26() {
    var a = [], i;
    for (i = 0; i < 26; i++) a.push(0);
    return a;
}

function countsOf(word) {
    var c = zeros26(), i;
    for (i = 0; i < word.length; i++) c[word.charCodeAt(i) - A]++;
    return c;
}

function distinctOf(counts) {
    var d = [], i;
    for (i = 0; i < 26; i++) if (counts[i] > 0) d.push({ i: i, n: counts[i] });
    return d;
}

/* ------------------------------------------------------------------- input */

var bankRaw = parseJson(readFile("tools\\word-clue-bank.json"));

var trickySet = {};
(function () {
    var i, list = bankRaw.tricky || [];
    for (i = 0; i < list.length; i++) trickySet[list[i]] = true;
})();

/*
 * Lever three, the difficulty of an individual clue and answer pair. Derived
 * rather than hand scored for six hundred entries: length, awkward letters and
 * a hand kept list of the answers whose clue is real wordplay.
 */
function rareLoad(word) {
    var i, c, s = 0;
    for (i = 0; i < word.length; i++) {
        c = word.charAt(i);
        if ("JQXZ".indexOf(c) >= 0) s += 1.2;
        else if ("KVWY".indexOf(c) >= 0) s += 0.55;
        else if ("BFGHMP".indexOf(c) >= 0) s += 0.14;
    }
    return s;
}

function pairRate(word, clue) {
    var r = (word.length - 3) * 0.34 + rareLoad(word);
    if (trickySet[word]) r += 1.2;
    if (clue.length > 34) r += 0.25;
    return r;
}

var BANK = [];
var bankFreq = zeros26();
(function () {
    var w, counts;
    for (w in bankRaw.words) {
        if (!bankRaw.words.hasOwnProperty(w)) continue;
        counts = countsOf(w);
        BANK.push({
            w: w,
            clue: bankRaw.words[w],
            len: w.length,
            counts: counts,
            dist: distinctOf(counts),
            rate: pairRate(w, bankRaw.words[w])
        });
        for (var i = 0; i < 26; i++) bankFreq[i] += counts[i];
    }
})();

var rarity = zeros26();
(function () {
    var i, total = 0;
    for (i = 0; i < 26; i++) total += bankFreq[i];
    for (i = 0; i < 26; i++) rarity[i] = total / (bankFreq[i] * 26 + 1);
})();

say("bank: " + BANK.length + " answers");

/* Theme words are pulled from the bank per pack, so one shared bank serves all
   five themes and only the tagged list changes. */
function themeSet(name) {
    var set = {}, i, list = bankRaw.themes[name] || [];
    for (i = 0; i < list.length; i++) set[list[i]] = true;
    return set;
}

/* ------------------------------------------------------------------ solver */

var MIN_LEN = 3;

function quoteWordSet(quote) {
    var set = {}, parts = quote.toUpperCase().split(/[^A-Z]+/), i;
    for (i = 0; i < parts.length; i++) if (parts[i].length) set[parts[i]] = true;
    return set;
}

/*
 * Depth first search over the bank. State is the multiset of quote letters not
 * yet claimed by an answer. A word may leave exactly one of its own letters
 * unmatched, which is both a difficulty lever and the slack that makes an exact
 * cover findable at all.
 */
function search(cells, cfg, rng, usedBefore) {
    var pool = zeros26(), i;
    for (i = 0; i < cells.length; i++) pool[cells[i].code]++;
    var total = cells.length;
    var banned = quoteWordSet(cfg.quote);

    var maxLen = cfg.maxLen;
    var candidates = [];
    for (i = 0; i < BANK.length; i++) {
        if (BANK[i].len < MIN_LEN || BANK[i].len > maxLen) continue;
        if (banned[BANK[i].w]) continue;
        candidates.push(BANK[i]);
    }

    var nodes = 0;

    function tryWord(e) {
        var d, k, deficit = -1, deficitCount = 0;
        for (k = 0; k < e.dist.length; k++) {
            d = e.dist[k];
            if (pool[d.i] < d.n) {
                deficitCount += (d.n - pool[d.i]);
                deficit = d.i;
            }
        }
        if (deficitCount === 0) return { free: -1, consumed: e.len };
        if (deficitCount === 1) return { free: deficit, consumed: e.len - 1 };
        return null;
    }

    function abundantLetter(e) {
        /* the safest letter to drop voluntarily is the one the quote has most of */
        var k, bi = -1, bn = -1;
        for (k = 0; k < e.dist.length; k++) {
            if (pool[e.dist[k].i] > bn) { bn = pool[e.dist[k].i]; bi = e.dist[k].i; }
        }
        return bi;
    }

    function take(e, free) {
        var k, d;
        for (k = 0; k < e.dist.length; k++) {
            d = e.dist[k];
            pool[d.i] -= d.n;
        }
        if (free >= 0) pool[free] += 1;
    }

    function give(e, free) {
        var k, d;
        for (k = 0; k < e.dist.length; k++) {
            d = e.dist[k];
            pool[d.i] += d.n;
        }
        if (free >= 0) pool[free] -= 1;
    }

    function scoreWord(e, consumed) {
        var k, s = 0, d;
        for (k = 0; k < e.dist.length; k++) {
            d = e.dist[k];
            s += rarity[d.i] * Math.min(d.n, pool[d.i]) * 10;
        }
        s += consumed * 0.6;
        if (cfg.theme[e.w]) s += cfg.themeBonus;
        /* lever three: a hard puzzle leans towards the harder pairs on purpose */
        s += cfg.pairPull * e.rate;
        if (usedBefore[e.w]) s -= 8;
        return s + rng.next() * cfg.jitter;
    }

    function recurse(chosen, claimed, freeUsed, themeUsed, K) {
        if (nodes++ > cfg.nodeCap) return null;

        var slotsLeft = K - chosen.length;
        var left = total - claimed;

        if (slotsLeft === 0) {
            if (left < cfg.minLeftover || left > cfg.maxLeftover) return null;
            if (freeUsed < cfg.minFree || freeUsed > cfg.maxFree) return null;
            if (themeUsed < cfg.minTheme) return null;
            return chosen.slice(0);
        }

        if (left - cfg.maxLeftover > slotsLeft * maxLen) return null;
        if (left - cfg.minLeftover < slotsLeft * (MIN_LEN - 1)) return null;

        var needTheme = cfg.minTheme - themeUsed;
        var forceTheme = needTheme >= slotsLeft;

        var top = [], topScore = [], i, e, fit, sc, j, alt;

        for (i = 0; i < candidates.length; i++) {
            e = candidates[i];
            if (chosen.taken[e.w]) continue;
            if (cfg.blockReuse && usedBefore[e.w]) continue;
            if (forceTheme && !cfg.theme[e.w]) continue;
            fit = tryWord(e);
            if (fit === null) continue;
            if (fit.free >= 0 && freeUsed >= cfg.maxFree) continue;
            if (claimed + fit.consumed > total - cfg.minLeftover) continue;

            sc = scoreWord(e, fit.consumed);
            /* keep the top cfg.branch candidates without sorting everything */
            if (top.length < cfg.branch) {
                top.push({ e: e, fit: fit }); topScore.push(sc);
            } else {
                var worst = 0;
                for (j = 1; j < top.length; j++) if (topScore[j] < topScore[worst]) worst = j;
                if (sc > topScore[worst]) { top[worst] = { e: e, fit: fit }; topScore[worst] = sc; }
            }
        }

        for (i = 0; i < top.length; i++) {
            for (j = i + 1; j < top.length; j++) {
                if (topScore[j] > topScore[i]) {
                    var tv = top[i]; top[i] = top[j]; top[j] = tv;
                    var ts = topScore[i]; topScore[i] = topScore[j]; topScore[j] = ts;
                }
            }
        }

        for (i = 0; i < top.length; i++) {
            e = top[i].e;
            fit = top[i].fit;

            var options = [fit];
            /* a fully fitting word may still volunteer one unmapped letter */
            if (fit.free < 0 && freeUsed < cfg.maxFree && slotsLeft <= cfg.maxFree + 2) {
                alt = abundantLetter(e);
                if (alt >= 0) options.push({ free: alt, consumed: e.len - 1 });
            }

            for (j = 0; j < options.length; j++) {
                var opt = options[j];
                if (claimed + opt.consumed > total - cfg.minLeftover) continue;

                take(e, opt.free);
                chosen.push({ e: e, free: opt.free });
                chosen.taken[e.w] = true;

                var res = recurse(chosen, claimed + opt.consumed,
                    freeUsed + (opt.free >= 0 ? 1 : 0),
                    themeUsed + (cfg.theme[e.w] ? 1 : 0), K);

                chosen.taken[e.w] = false;
                chosen.pop();
                give(e, opt.free);

                if (res) return res;
                if (nodes > cfg.nodeCap) return null;
            }
        }
        return null;
    }

    var kList = cfg.clueCounts;
    for (i = 0; i < kList.length; i++) {
        var seed = [];
        seed.taken = {};
        nodes = 0;
        var best = recurse(seed, 0, 0, 0, kList[i]);
        if (best) return { words: best, k: kList[i], nodes: nodes };
    }
    return null;
}

/* ----------------------------------------------------------------- mapping */

function spans(quote) {
    /* cell index -> the quote word it sits in, that word's length and its offset */
    var up = quote.toUpperCase(), i, cell = 0, out = [], run = [], c, wid = 0;
    for (i = 0; i <= up.length; i++) {
        c = i < up.length ? up.charAt(i) : " ";
        if (isAlpha(c)) { run.push(cell); cell++; }
        else if (run.length) {
            for (var j = 0; j < run.length; j++) {
                out[run[j]] = { len: run.length, pos: j, id: wid };
            }
            wid++;
            run = [];
        }
    }
    return out;
}

function cellDropScore(ci, cells, wordSpan, holesInWord, taken, cfg, rng) {
    var sp = wordSpan[ci] || { len: 1, pos: 0, id: -1 };
    var s = 0;
    /* never strand a short word, and keep first letters visible as an anchor */
    if (sp.len <= 3) s -= 100;
    if (sp.pos === 0) s -= 40;
    if (sp.pos === sp.len - 1) s -= 10;
    /* one hole per quote word, and never two holes side by side */
    if (holesInWord[sp.id]) s -= 120 * holesInWord[sp.id];
    if (taken[ci - 1] || taken[ci + 1]) s -= 60;
    /* harder packs leave cells late in the quote, where context helps least */
    s += (ci / cells.length) * cfg.latePull;
    s += rng.next() * 6;
    return s;
}

/*
 * Turns the chosen answers into concrete cell assignments. Cells that stay
 * unassigned are the ones no clue feeds, so they are picked deliberately rather
 * than by whatever happens to be left over.
 */
function buildMapping(cells, chosen, cfg, rng) {
    var byLetter = [], i, j;
    for (i = 0; i < 26; i++) byLetter.push([]);
    for (i = 0; i < cells.length; i++) byLetter[cells[i].code].push(i);

    var demand = zeros26();
    for (i = 0; i < chosen.length; i++) {
        var e = chosen[i].e, free = chosen[i].free, seenFree = false;
        for (j = 0; j < e.w.length; j++) {
            var code = e.w.charCodeAt(j) - A;
            if (!seenFree && code === free) { seenFree = true; continue; }
            demand[code]++;
        }
    }

    var wordSpan = spans(cfg.quote);
    var leftoverCells = {};
    var holesInWord = {};
    for (i = 0; i < 26; i++) {
        var slack = byLetter[i].length - demand[i];
        for (var s = 0; s < slack; s++) {
            var pick = -1, pickScore = -1e9;
            for (j = 0; j < byLetter[i].length; j++) {
                var ci = byLetter[i][j];
                if (leftoverCells[ci]) continue;
                var sc2 = cellDropScore(ci, cells, wordSpan, holesInWord, leftoverCells, cfg, rng);
                if (sc2 > pickScore) { pickScore = sc2; pick = ci; }
            }
            if (pick < 0) return null;
            leftoverCells[pick] = true;
            var key = wordSpan[pick] ? wordSpan[pick].id : -1;
            holesInWord[key] = (holesInWord[key] || 0) + 1;
        }
    }

    var open = [];
    for (i = 0; i < 26; i++) open.push([]);
    for (i = 0; i < cells.length; i++) if (!leftoverCells[i]) open[cells[i].code].push(i);
    for (i = 0; i < 26; i++) rng.shuffle(open[i]);

    var clues = [];
    for (i = 0; i < chosen.length; i++) {
        var ent = chosen[i].e, fr = chosen[i].free, usedFree = false;
        var map = [];
        for (j = 0; j < ent.w.length; j++) {
            var c2 = ent.w.charCodeAt(j) - A;
            if (!usedFree && c2 === fr) { usedFree = true; map.push(-1); continue; }
            if (!open[c2].length) return null;
            map.push(open[c2].pop());
        }
        clues.push({ a: ent.w, c: ent.clue, m: map, rate: ent.rate });
    }

    for (i = 0; i < 26; i++) if (open[i].length) return null;

    var free = [];
    for (i = 0; i < cells.length; i++) if (leftoverCells[i]) free.push(i);
    return { clues: clues, free: free };
}

/* ---------------------------------------------------------- hidden letters */

/*
 * Levers four and five. A number belongs to a letter, so dropping the number
 * from a letter the quote leans on removes a large part of the map at once,
 * while dropping it from a letter used twice is a local puzzle. Easy puzzles
 * hide rare letters, hard ones hide a workhorse.
 *
 * Fairness rules, all of them learned the hard way:
 *   - a hidden letter must appear in at least one answer, or its cells can only
 *     be reached by guessing the quote outright
 *   - the unnumbered share of the quote is capped
 *   - every quote word keeps at least one numbered cell
 */
function pickHidden(cells, clues, cfg, rng) {
    var i, j, count = {}, order = [];
    for (i = 0; i < cells.length; i++) {
        var ch = cells[i].ch;
        if (count[ch]) count[ch]++;
        else { count[ch] = 1; order.push(ch); }
    }

    var inAnswer = {};
    for (i = 0; i < clues.length; i++) {
        for (j = 0; j < clues[i].a.length; j++) inAnswer[clues[i].a.charAt(j)] = true;
    }

    var wordSpan = spans(cfg.quote);
    var wordCells = {};
    for (i = 0; i < cells.length; i++) {
        var id = wordSpan[i] ? wordSpan[i].id : -1;
        if (!wordCells[id]) wordCells[id] = [];
        wordCells[id].push(cells[i].ch);
    }

    function wordsSurvive(set) {
        var k, w, n, all;
        for (k in wordCells) {
            if (!wordCells.hasOwnProperty(k)) continue;
            w = wordCells[k];
            n = 0;
            for (var q = 0; q < w.length; q++) if (!set[w[q]]) n++;
            all = w.length;
            /* a word of three letters or fewer keeps one number, longer words
               keep at least a third of theirs */
            if (all <= 3 && n < 1) return false;
            if (all > 3 && n < Math.ceil(all / 3)) return false;
        }
        return true;
    }

    var target = cfg.hideCount;
    var capShare = cfg.hideShare;
    var chosen = {}, list = [], hiddenCells = 0;

    for (var pickNo = 0; pickNo < target; pickNo++) {
        var best = null, bestScore = -1e9;
        for (i = 0; i < order.length; i++) {
            var c = order[i];
            if (chosen[c]) continue;
            if (!inAnswer[c]) continue;
            if ((hiddenCells + count[c]) / cells.length > capShare) continue;
            chosen[c] = true;
            var okWords = wordsSurvive(chosen);
            chosen[c] = false;
            if (!okWords) continue;

            /* bias: how much of the map this letter is worth */
            var freq = count[c] / cells.length;
            var sc;
            if (cfg.hideBias === "common") sc = freq * 100;
            else if (cfg.hideBias === "mixed") sc = 40 - Math.abs(freq - 0.06) * 400;
            else sc = 60 - freq * 300;
            if (COMMON.indexOf(c) >= 0) sc += cfg.hideBias === "common" ? 14 : -6;
            sc += rng.next() * 5;
            if (sc > bestScore) { bestScore = sc; best = c; }
        }
        if (best === null) break;
        chosen[best] = true;
        list.push(best);
        hiddenCells += count[best];
    }

    return { list: list, cells: hiddenCells };
}

/* ------------------------------------------------------------------ verify */

/* Nothing downstream can recover from a bad mapping, so check it hard here. */
function verify(cells, clues, free, hide) {
    var seen = {}, i, j, m, problems = [];

    for (i = 0; i < clues.length; i++) {
        var mapped = 0;
        if (clues[i].m.length !== clues[i].a.length) {
            problems.push(clues[i].a + ": map length does not match the answer");
        }
        for (j = 0; j < clues[i].m.length; j++) {
            m = clues[i].m[j];
            if (m < 0) continue;
            mapped++;
            if (seen[m]) problems.push("cell " + m + " claimed twice");
            seen[m] = true;
            if (cells[m].ch !== clues[i].a.charAt(j)) {
                problems.push(clues[i].a + " position " + j + " points at cell " +
                    m + " which holds " + cells[m].ch);
            }
        }
        if (mapped < 1) problems.push(clues[i].a + " feeds no quote cell");
    }

    for (i = 0; i < free.length; i++) {
        if (seen[free[i]]) problems.push("cell " + free[i] + " is both mapped and unindexed");
        seen[free[i]] = true;
    }
    for (i = 0; i < cells.length; i++) {
        if (!seen[i]) problems.push("cell " + i + " (" + cells[i].ch + ") is unaccounted for");
    }

    /* a hidden letter the player can never reach from a clue is unfair */
    var inAnswer = {};
    for (i = 0; i < clues.length; i++) {
        for (j = 0; j < clues[i].a.length; j++) inAnswer[clues[i].a.charAt(j)] = true;
    }
    for (i = 0; i < hide.length; i++) {
        if (!inAnswer[hide[i]]) {
            problems.push("hidden letter " + hide[i] + " appears in no answer");
        }
    }
    return problems;
}

/* -------------------------------------------------------------- difficulty */

function difficulty(p, cells, clues, free, hidden, cfg) {
    var i, j, freq = zeros26(), vowels = 0, common = 0, totalLen = 0, rateSum = 0;
    for (i = 0; i < cells.length; i++) {
        freq[cells[i].code]++;
        if (VOWELS.indexOf(cells[i].ch) >= 0) vowels++;
        if (COMMON.indexOf(cells[i].ch) >= 0) common++;
    }
    for (i = 0; i < clues.length; i++) {
        totalLen += clues[i].a.length;
        rateSum += clues[i].rate;
    }

    var freeAnswer = 0;
    for (i = 0; i < clues.length; i++) {
        for (j = 0; j < clues[i].m.length; j++) if (clues[i].m[j] < 0) freeAnswer++;
    }

    var distinct = 0;
    for (i = 0; i < 26; i++) if (freq[i]) distinct++;

    /* lever eight: how much of the quote is short connecting words */
    var stopLetters = 0, parts = p.quote.toUpperCase().split(/[^A-Z]+/);
    for (i = 0; i < parts.length; i++) {
        if (!parts[i].length) continue;
        for (j = 0; j < STOPWORDS.length; j++) {
            if (parts[i] === STOPWORDS[j]) { stopLetters += parts[i].length; break; }
        }
    }

    var vowelRatio = vowels / cells.length;
    var commonShare = common / cells.length;
    var stopShare = stopLetters / cells.length;
    var hideShare = hidden.cells / cells.length;
    var pairLoad = rateSum / clues.length;
    var avgLen = totalLen / clues.length;

    /*
     * Weights are set so that no single lever can carry a puzzle: content has to
     * move several of them together to climb a band.
     */
    var score = 2.6 * clues.length          /* 2. how many pairs */
        + 1.05 * cells.length               /* 1. quote length */
        + 3.2 * hidden.list.length          /* 4. how many letters lose the number */
        + 30 * hideShare                    /* 5. how much of the map that costs */
        + 1.0 * distinct                    /* 6. unique letters */
        + 12 * (1 - vowelRatio)             /* 7. vowels */
        + 14 * (1 - commonShare)            /* 7. common letters */
        + 16 * (1 - stopShare)              /* 8. connecting words */
        + 3.2 * pairLoad                    /* 3. pair difficulty */
        + 1.1 * (free.length + freeAnswer); /* answer letters off the quote */

    return {
        score: Math.round(score * 10) / 10,
        letters: cells.length,
        clues: clues.length,
        distinct: distinct,
        hidden: hidden.list.length,
        hideShare: Math.round(hideShare * 1000) / 1000,
        freeQuote: free.length,
        freeAnswer: freeAnswer,
        vowelRatio: Math.round(vowelRatio * 1000) / 1000,
        commonShare: Math.round(commonShare * 1000) / 1000,
        stopShare: Math.round(stopShare * 1000) / 1000,
        pairLoad: Math.round(pairLoad * 100) / 100,
        avgLen: Math.round(avgLen * 100) / 100
    };
}

/* -------------------------------------------------------------------- main */

function locateQuote(fact, quote) {
    var i, at;
    for (i = 0; i < fact.length; i++) {
        at = fact[i].indexOf(quote);
        if (at >= 0) return { para: i, start: at, end: at + quote.length };
    }
    return null;
}

function reportFor(p, cells, clues, free, hide, stats) {
    var lines = [], i, j;
    var freeSet = {};
    for (i = 0; i < free.length; i++) freeSet[free[i]] = true;
    var hideSet = {};
    for (i = 0; i < hide.length; i++) hideSet[hide[i]] = true;

    lines.push("#" + p.id + "  " + p.title + "  [" + p.band + "]  score=" + stats.score);
    lines.push("  quote    : " + p.quote);

    /* the quote as the player first sees it: an unnumbered letter shows as a dot */
    var shown = "", ci = 0, up = p.quote.toUpperCase(), c;
    for (i = 0; i < up.length; i++) {
        c = up.charAt(i);
        if (isAlpha(c)) { shown += hideSet[c] ? "." : c; ci++; }
        else shown += c;
    }
    lines.push("  unnumbered: " + shown);
    lines.push("  hidden   : " + hide.join(" ") + "  (" +
        Math.round(stats.hideShare * 100) + "% of cells)");
    lines.push("  levers   : letters=" + stats.letters + " clues=" + stats.clues +
        " distinct=" + stats.distinct + " pairLoad=" + stats.pairLoad +
        " vowels=" + stats.vowelRatio + " common=" + stats.commonShare +
        " stop=" + stats.stopShare + " qFree=" + stats.freeQuote +
        " aFree=" + stats.freeAnswer);
    for (i = 0; i < clues.length; i++) {
        var marks = "";
        for (j = 0; j < clues[i].m.length; j++) marks += (clues[i].m[j] < 0 ? "-" : clues[i].a.charAt(j));
        lines.push("  " + String.fromCharCode(65 + i) + ". " + clues[i].a +
            " (" + marks + ")  " + clues[i].c);
    }
    lines.push("");
    return lines.join("\r\n");
}

/*
 * The content side of difficulty, measured before any solving. Ordering a theme
 * by this and then applying the pack's ladder to each slot means an author can
 * write ten facts in any order and still get a rising pack: length, unique
 * letters, how few vowels and workhorse letters there are, and how little the
 * quote leans on short connecting words.
 */
function contentScore(quote) {
    var i, j, c, up = quote.toUpperCase();
    var n = 0, vow = 0, com = 0, seen = {}, dis = 0;
    for (i = 0; i < up.length; i++) {
        c = up.charAt(i);
        if (c < "A" || c > "Z") continue;
        n++;
        if (VOWELS.indexOf(c) >= 0) vow++;
        if (COMMON.indexOf(c) >= 0) com++;
        if (!seen[c]) { seen[c] = 1; dis++; }
    }
    var stop = 0, parts = up.split(/[^A-Z]+/);
    for (i = 0; i < parts.length; i++) {
        if (!parts[i].length) continue;
        for (j = 0; j < STOPWORDS.length; j++) {
            if (parts[i] === STOPWORDS[j]) { stop += parts[i].length; break; }
        }
    }
    return n * 1.0 + dis * 0.8 + (1 - stop / n) * 20 +
        (1 - com / n) * 15 + (1 - vow / n) * 10;
}

function orderByContent(puzzles) {
    var list = [], i, j;
    for (i = 0; i < puzzles.length; i++) {
        list.push({ p: puzzles[i], s: contentScore(puzzles[i].quote) });
    }
    for (i = 0; i < list.length; i++) {
        for (j = i + 1; j < list.length; j++) {
            if (list[j].s < list[i].s) { var t = list[i]; list[i] = list[j]; list[j] = t; }
        }
    }
    var out = [];
    for (i = 0; i < list.length; i++) out.push(list[i].p);
    return out;
}

var packsOut = [];
var failures = [];
var reportText = "";

for (var si = 0; si < SOURCES.length; si++) {
    var source = parseJson(readFile(SOURCES[si]));
    var theme = themeSet(source.theme);
    var usedBefore = {};
    var out = [];
    /*
     * A source file says how its ten slots are configured in one of two ways.
     * With a ladder, the ten rungs are fixed and the content is sorted into them
     * by contentScore, so facts can be written in any order. Without one, every
     * puzzle pins its own settings and file order is taken as the ladder.
     */
    var ordered, ladder;
    if (source.ladder) {
        ordered = orderByContent(source.puzzles);
        ladder = source.ladder;
        if (ladder.length < ordered.length) {
            failures.push(source.theme + ": the ladder has fewer rungs than puzzles");
            continue;
        }
    } else {
        ordered = source.puzzles;
        ladder = source.puzzles;
    }

    say("");
    say(source.pack.name + "  (" + source.puzzles.length + " puzzles, theme words: " +
        (bankRaw.themes[source.theme] || []).length + ")");
    reportText += "==========  " + source.pack.name + "  ==========\r\n\r\n";

    for (var pi = 0; pi < ordered.length; pi++) {
        /* content in difficulty order, the ladder slot it lands in on top */
        var rung = ladder[pi];
        var p = ordered[pi];
        p.id = pi + 1;
        p.band = rung.band;
        var cells = letterCells(p.quote);
        var loc = locateQuote(p.fact, p.quote);
        if (!loc) {
            failures.push(source.theme + " #" + p.id +
                ": quote sentence does not appear verbatim in the fun fact");
            continue;
        }

        var cfg = {
            quote: p.quote,
            clueCounts: rung.clues,
            minLeftover: rung.quoteFree[0],
            maxLeftover: rung.quoteFree[1],
            minFree: rung.answerFree[0],
            maxFree: rung.answerFree[1],
            minTheme: typeof rung.themeWords === "number" ? rung.themeWords : 2,
            maxLen: rung.maxLen || 8,
            theme: theme,
            themeBonus: 10,
            pairPull: typeof rung.pairPull === "number" ? rung.pairPull : 0,
            hideCount: rung.hideCount || 2,
            hideBias: rung.hideBias || "rare",
            hideShare: rung.hideShare || 0.3,
            branch: 14,
            jitter: 6,
            latePull: rung.latePull || 10,
            nodeCap: 20000
        };

        var mapping = null, hidden = null, attempt = 0, solved = null;
        var t0 = new Date().getTime();
        for (attempt = 0; attempt < 60 && !mapping; attempt++) {
            /* a puzzle that will not solve should say so rather than hang a build */
            if (new Date().getTime() - t0 > 60000) break;
            /* keep answers unique inside a theme, and only relax that if stuck */
            cfg.blockReuse = attempt < 40;
            var rng = new Rng(1000 + si * 31337 + pi * 7919 + attempt * 104729);
            solved = search(cells, cfg, rng, usedBefore);
            if (!solved) continue;
            mapping = buildMapping(cells, solved.words, cfg, rng);
            if (!mapping) continue;
            hidden = pickHidden(cells, mapping.clues, cfg, rng);
            if (hidden.list.length < cfg.hideCount) { mapping = null; continue; }
        }
        var ms = new Date().getTime() - t0;

        if (!mapping) {
            var have = zeros26(), i2;
            for (i2 = 0; i2 < cells.length; i2++) have[cells[i2].code]++;
            var rep = [];
            for (i2 = 0; i2 < 26; i2++) if (have[i2]) rep.push(String.fromCharCode(A + i2) + have[i2]);
            failures.push(source.theme + " #" + p.id + ": no answer set covers " +
                cells.length + " letters in " + cfg.clueCounts.join("/") +
                " clues [" + rep.join(" ") + "]");
            continue;
        }

        var bad = verify(cells, mapping.clues, mapping.free, hidden.list);
        if (bad.length) {
            for (var vi = 0; vi < bad.length; vi++) {
                failures.push(source.theme + " #" + p.id + ": " + bad[vi]);
            }
            continue;
        }

        for (var ci2 = 0; ci2 < mapping.clues.length; ci2++) {
            usedBefore[mapping.clues[ci2].a] = true;
        }

        var stats = difficulty(p, cells, mapping.clues, mapping.free, hidden, cfg);
        reportText += reportFor(p, cells, mapping.clues, mapping.free, hidden.list, stats);

        /* rate is a build time signal only, so it does not ship */
        var shipClues = [];
        for (var k2 = 0; k2 < mapping.clues.length; k2++) {
            shipClues.push({
                a: mapping.clues[k2].a,
                c: mapping.clues[k2].c,
                m: mapping.clues[k2].m
            });
        }

        out.push({
            id: p.id,
            band: p.band,
            title: p.title,
            art: p.art,
            quote: p.quote,
            fact: p.fact,
            factPara: loc.para,
            factStart: loc.start,
            factEnd: loc.end,
            clues: shipClues,
            free: mapping.free,
            hide: hidden.list,
            stats: stats
        });

        say("  #" + p.id + " " + p.title + "  letters=" + stats.letters +
            " clues=" + stats.clues + " hidden=" + hidden.list.join("") +
            " score=" + stats.score + "  (" + attempt + " tries, " + ms + "ms)");
    }

    /* difficulty must climb from puzzle 1 to puzzle 10 inside every theme */
    for (var s2 = 1; s2 < out.length; s2++) {
        if (out[s2].stats.score <= out[s2 - 1].stats.score) {
            failures.push(source.theme + ": #" + out[s2].id + " (" + out[s2].stats.score +
                ") is not harder than #" + out[s2 - 1].id + " (" + out[s2 - 1].stats.score + ")");
        }
    }

    packsOut.push({
        pack: source.pack,
        tab: source.tab,
        emoji: source.emoji,
        puzzles: out
    });
}

if (failures.length) {
    say("");
    say("BUILD FAILED");
    for (var fi = 0; fi < failures.length; fi++) say("  " + failures[fi]);
    WScript.Quit(1);
}

var json = dump(packsOut);
writeFile("tools\\puzzles.generated.json", json);
writeFile("tools\\puzzles-report.txt", reportText);
say("");
say("wrote tools/puzzles.generated.json (" + json.length + " bytes)");

/* inject straight into the single-file game */
var GAME = "index.html";
if (fso.FileExists(fso.BuildPath(ROOT, GAME))) {
    var html = readFile(GAME);
    var startTag = "/* PUZZLE_DATA_START */";
    var endTag = "/* PUZZLE_DATA_END */";
    var s1 = html.indexOf(startTag), s3 = html.indexOf(endTag);
    if (s1 >= 0 && s3 > s1) {
        html = html.substring(0, s1 + startTag.length) +
            "\nconst PACK_DATA = " + json + ";\n" +
            html.substring(s3);
        writeFile(GAME, html);
        say("injected five packs into index.html");
    } else {
        say("index.html has no PUZZLE_DATA markers, skipped injection");
    }
} else {
    say("index.html not present yet, skipped injection");
}

say("done");
