/**
 * दो कुल्हड़ चाय — पाठकों की राय
 * A tiny collector for ratings and comments, kept in a Google Sheet.
 * Readers need no account; you keep the data and moderate it by hand.
 *
 * SET-UP (about five minutes)
 *   1. Make a new Google Sheet (any name).
 *   2. Extensions ▸ Apps Script. Delete what is there and paste this file.
 *   3. Deploy ▸ New deployment ▸ type "Web app".
 *        Execute as:      Me
 *        Who has access:  Anyone
 *      Deploy, allow the permissions, and copy the "Web app" URL.
 *   4. Paste that URL as REVIEWS.endpoint in src/data/books.js, then rebuild.
 *
 * MODERATION
 *   Every rating counts at once. A comment appears on the site only after you
 *   write  Y  in its "approved" cell (column G). To remove anyone's rating or
 *   comment, delete the row. Set REQUIRE_APPROVAL to false to publish
 *   comments straight away.
 *
 * After changing this script, use Deploy ▸ Manage deployments ▸ edit ▸
 * "New version" so the live URL runs the new code.
 */

var SHEET_NAME = "Reviews";
var HEADERS = ["time", "slug", "device", "rating", "name", "comment", "approved"];
var REQUIRE_APPROVAL = true;
var MAX_COMMENTS = 40;

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
  }
  return sh;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

/** The tally and the approved comments for one book. */
function doGet(e) {
  var slug = String((e && e.parameter && e.parameter.slug) || "");
  var rows = sheet_().getDataRange().getValues().slice(1);
  var dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  var sum = 0;
  var count = 0;
  var comments = [];

  rows.forEach(function (r) {
    if (String(r[1]) !== slug) return;
    var n = Number(r[3]);
    if (!(n >= 1 && n <= 5)) return;
    dist[n] += 1;
    sum += n;
    count += 1;
    var text = String(r[5] || "").trim();
    var ok = !REQUIRE_APPROVAL || String(r[6]).toUpperCase() === "Y";
    if (text && ok) {
      comments.push({
        name: String(r[4] || ""),
        rating: n,
        comment: text,
        at: new Date(r[0]).toISOString(),
      });
    }
  });

  comments.sort(function (a, b) {
    return a.at < b.at ? 1 : -1;
  });

  return json_({
    ok: true,
    slug: slug,
    count: count,
    average: count ? Math.round((sum / count) * 10) / 10 : 0,
    distribution: dist,
    comments: comments.slice(0, MAX_COMMENTS),
  });
}

/** One rating (and optional name + comment) from one device. */
function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var d = JSON.parse((e && e.postData && e.postData.contents) || "{}");

    // a hidden field a person never fills in: if it has text, it was a robot
    if (d.hp) return json_({ ok: true });

    var rating = Math.round(Number(d.rating));
    var slug = String(d.slug || "").slice(0, 80);
    var device = String(d.device || "").slice(0, 64);
    if (!(rating >= 1 && rating <= 5) || !slug || !device) {
      return json_({ ok: false, error: "invalid" });
    }
    var name = String(d.name || "").trim().slice(0, 40);
    var comment = String(d.comment || "").trim().slice(0, 600);

    var sh = sheet_();
    var data = sh.getDataRange().getValues();
    var row = [new Date(), slug, device, rating, name, comment, ""];

    // one voice per device per book: a returning reader changes their own row
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][1]) === slug && String(data[i][2]) === device) {
        var sameText = String(data[i][5]) === comment;
        row[6] = sameText ? data[i][6] : ""; // new words need approving again
        sh.getRange(i + 1, 1, 1, 7).setValues([row]);
        return json_({ ok: true, pending: !!comment && REQUIRE_APPROVAL && row[6] !== "Y" });
      }
    }
    sh.appendRow(row);
    return json_({ ok: true, pending: !!comment && REQUIRE_APPROVAL });
  } catch (err) {
    return json_({ ok: false, error: "server" });
  } finally {
    lock.releaseLock();
  }
}
