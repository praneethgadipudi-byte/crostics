/*
 * Source auditor  --  dev only.
 *
 * Run:  cscript //nologo tools\audit-source.js source-space.json
 *
 * Prints the content side levers for every puzzle in a source file without
 * running the solver, so a quote can be sized and ordered in seconds rather than
 * after a two minute build. Also checks that each quote appears verbatim in its
 * fun fact, which is the mistake that breaks a build most often.
 */

var fso = new ActiveXObject("Scripting.FileSystemObject");
var ROOT = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName));

function readFile(rel) {
    var p = fso.BuildPath(ROOT, rel);
    if (!fso.FileExists(p)) throw new Error("missing file: " + rel);
    var s = fso.OpenTextFile(p, 1, false, 0);
    var t = s.AtEndOfStream ? "" : s.ReadAll();
    s.Close();
    return t;
}

function say(m) { WScript.Echo(m); }

var VOWELS = "AEIOU";
var COMMON = "ETAOINSHR";
var STOPWORDS = ("THE A AN AND OR OF TO IN ON AT IT IS ARE WAS WERE BE BEEN AS BY " +
    "FOR FROM WITH THAT THIS THESE THOSE NOT NO SO BUT IF THEN THAN THEY THEM " +
    "ITS HIS HER OUR YOUR YOU WE I HE SHE ONE TWO ALL ANY CAN HAS HAVE HAD DO " +
    "DOES DID WILL WOULD MORE MOST OUT UP OVER UNDER INTO ABOUT AFTER BEFORE " +
    "STILL EVER NEVER ONCE ONLY EVEN JUST").split(" ");

/* same measure the builder sorts a pack by */
function content(quote) {
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
    return n * 1.0 + dis * 0.8 + (1 - stop / n) * 20 + (1 - com / n) * 15 + (1 - vow / n) * 10;
}

var files = [];
if (WScript.Arguments.length) {
    for (var a = 0; a < WScript.Arguments.length; a++) files.push("tools\\" + WScript.Arguments(a));
} else {
    files = ["tools\\source-food.json", "tools\\source-space.json", "tools\\source-body.json",
             "tools\\source-ancient.json", "tools\\source-animals.json"];
}

for (var f = 0; f < files.length; f++) {
    if (!fso.FileExists(fso.BuildPath(ROOT, files[f]))) { say(files[f] + ": not present"); continue; }
    var src = eval("(" + readFile(files[f]) + ")");
    say("");
    say("==== " + src.pack.name + "  (" + files[f] + ")");
    say("slot cscore let dis vow  com  stop rare  quote");

    /* the builder orders a pack by this score, so print it in that order too */
    var rows = [];
    for (var i0 = 0; i0 < src.puzzles.length; i0++) {
        rows.push({ p: src.puzzles[i0], s: content(src.puzzles[i0].quote) });
    }
    for (var a1 = 0; a1 < rows.length; a1++) {
        for (var b1 = a1 + 1; b1 < rows.length; b1++) {
            if (rows[b1].s < rows[a1].s) { var t1 = rows[a1]; rows[a1] = rows[b1]; rows[b1] = t1; }
        }
    }

    for (var i = 0; i < rows.length; i++) {
        var p = rows[i].p;
        var up = p.quote.toUpperCase(), j, c;
        var n = 0, vow = 0, com = 0, rare = 0, seen = {}, dis = 0;
        for (j = 0; j < up.length; j++) {
            c = up.charAt(j);
            if (c < "A" || c > "Z") continue;
            n++;
            if (VOWELS.indexOf(c) >= 0) vow++;
            if (COMMON.indexOf(c) >= 0) com++;
            if ("JQXZ".indexOf(c) >= 0) rare++;
            if (!seen[c]) { seen[c] = 1; dis++; }
        }
        var stop = 0, parts = up.split(/[^A-Z]+/);
        for (j = 0; j < parts.length; j++) {
            if (!parts[j].length) continue;
            for (var k = 0; k < STOPWORDS.length; k++) {
                if (parts[j] === STOPWORDS[k]) { stop += parts[j].length; break; }
            }
        }

        var found = false;
        for (j = 0; j < p.fact.length; j++) if (p.fact[j].indexOf(p.quote) >= 0) found = true;

        function pad(v, w) { var s = "" + v; while (s.length < w) s = " " + s; return s; }
        function r3(v) { return Math.round(v * 100) / 100; }

        say(pad(i + 1, 4) + pad(Math.round(rows[i].s), 7) +
            pad(n, 5) + pad(dis, 4) + pad(r3(vow / n), 5) + pad(r3(com / n), 5) +
            pad(r3(stop / n), 5) + pad(rare, 5) + "  " + (found ? "" : "[QUOTE NOT IN FACT] ") +
            p.quote);
    }
}
