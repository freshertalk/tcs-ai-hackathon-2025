// src/data/books.js
// ---------------------------------------------------------------------------
// Literary work. All Hindi content below is authored by Vinay Kumar Tiwari.
// Edit freely — every writing page on the site reads from this file.
//
// How this file is written
//   • Every quotation is taken word for word from the novel as published
//     (the EPUB in public/ebooks). Nothing is paraphrased and put in quotes.
//   • Descriptions (the premise, the cast, the themes) only use what the
//     reader learns in the book's first night and its first chapters. The
//     novel is a slow reveal; the site must not do the revealing for it.
// ---------------------------------------------------------------------------

// Ratings and comments (src/reviews). Signing in with Google is how a reader rates.
//   endpoint       the Web-app URL of scripts/reviews-apps-script.gs, once it is
//                  deployed from a Google Sheet. Empty = a reader's rating stays
//                  on their own device and they are offered an e-mail to you.
//   googleBooksId  a Google Books volume id (the id=… in its address), if the
//                  book is listed there and Google has a rating for it.
//   places         pages where the book can also be rated; only those with an
//                  address are shown. Fill them in once the book is listed.
// Sign in with Google (src/auth). No server and no database of your own.
//   googleClientId  the OAuth "Web application" client id from Google Cloud
//                   Console (it is public, not a secret). Empty = no sign-in:
//                   the site stays anonymous, exactly as before.
//   adminEmail      the one Google account that may moderate comments. The
//                   collector (scripts/reviews-apps-script.gs) enforces it —
//                   keep ADMIN_EMAIL there the same.
export const AUTH = {
  googleClientId: "886670255024-mhd165asnk3l9m3oio6limie2n9h7cff.apps.googleusercontent.com",
  adminEmail: "author.vinaytiwari1@gmail.com",
};

export const REVIEWS = {
  endpoint: "https://script.google.com/macros/s/AKfycbzfuDeSFktvkhvQRBOTeDPlPmerp5801BS2AVhVtg0-AvOti5rLQynmeXLivJOXT4rneQ/exec",
  googleBooksId: "",
  places: [
    { name: "Google Books", url: "" },
    { name: "Goodreads", url: "" },
    { name: "Amazon", url: "" },
  ],
};

export const BOOK = {
  // matches the slug the book is published under in the library
  slug: "do-kulhad-chai",

  // The E-Book price, as it is SHOWN: ₹ <mrp>/= only (struck through) and
  // ₹ <selling>/= only. What is actually charged is decided by the collector
  // (PRICES in scripts/reviews-apps-script.gs) — keep the two the same.
  price: { mrp: 399, selling: 115 },
  title: "दो कुल्हड़ चाय",
  roman: "Do Kulhad Chai",
  kind: "उपन्यास · Novel",
  language: "हिन्दी",
  status: "पहला उपन्यास · Debut novel",
  byline: "विनय कुमार तिवारी",
  bylineRoman: "Vinay Kumar Tiwari",

  // Facts shown in the "about the novel" block.
  // Exactly 6 cells so the grid (3 columns, 2 on mobile) never leaves a gap.
  // The "स्थिति" cell is replaced at runtime by the publication date.
  // ISBN is left empty on purpose: write it into `v` once there is one (an
  // empty value is drawn as a dash).
  facts: [
    { k: "विधा", v: "उपन्यास", hi: true },
    { k: "भाषा", v: "हिन्दी", hi: true },
    { k: "अध्याय", v: "36", hi: true },
    { k: "स्थिति", v: "प्रकाशित", hi: true },
    { k: "कॉपीराइट", v: "© 2026 लेखक", hi: true },
    { k: "ISBN", v: "", hi: false },
  ],

  // Three lines that stand before page one: the book's own cover line, and
  // the epigraphs of chapters 24 and 14.
  epigraphs: [
    "कुछ मुलाक़ातें अपनी मंज़िल तक नहीं पहुँचतीं…\nफिर भी पूरी ज़िंदगी साथ चलती हैं।",
    "प्रेम का सबसे सुंदर क्षण ‘मैं तुमसे प्रेम करता हूँ’ नहीं होता…\nवह होता है जब दो लोग पहली बार ‘कल’ के बारे में साथ सोचते हैं।",
    "कुछ लोग हमारी ज़िंदगी में हमेशा रहने नहीं आते।\nवे हमें हमेशा के लिए बदलने आते हैं।",
  ],

  // The dedication page, exactly as the book prints it.
  dedication: {
    to: "उन सब लोगों के नाम,",
    body:
      "जो हमारी ज़िंदगी में थोड़ी देर के लिए आए, लेकिन हमारे भीतर से कभी गए ही नहीं…",
  },

  factsQuote: "“कुछ मुलाक़ातें अपनी मंज़िल तक नहीं पहुँचतीं… फिर भी पूरी ज़िंदगी साथ चलती हैं।”",
  factsQuoteAttrib: "— विनय कुमार तिवारी (दो कुल्हड़ चाय)",

  route: "नई दिल्ली → कानपुर आउटर → बनारस",
  span: "2015 — 2026 · ग्यारह साल",

  // The book's own opening — its prologue, "दूसरा टिकट", in full.
  logline:
    "एक आदमी है, जो हर महीने की बारह तारीख़ को एक ट्रेन में चढ़ता है। वह हर बार दो टिकट लेता है। और वह हमेशा अकेला सफ़र करता है। यह किताब यह बताने के लिए लिखी गई है कि दूसरा टिकट किसका है।",

  // Three lines set under the premise on the front page: the book's own words,
  // the ones that stop a reader — the loneliness, the tiredness of hoping, what
  // stays behind. (The premise above them already ends on the question the
  // book exists to answer, so it is not repeated.) Word for word;
  // scripts/check-quotes.js checks every one against the published edition.
  highlight: {
    lines: [
      "अकेले आदमी दो चाय नहीं लेते।",
      "इंसान उम्मीद छोड़ने से नहीं थकता। बार-बार उम्मीद करने से थकता है।",
      "कुछ लोग चले नहीं जाते… बस हमारी आदतों में बदल जाते हैं।",
    ],
  },

  // What the book is, in a breath: everything here happens on its first night.
  premise:
    "12 जुलाई 2015। नई दिल्ली से बनारस जाती शिवगंगा एक्सप्रेस कानपुर आउटर पर एक लाल सिग्नल के सामने साढ़े चार घंटे खड़ी रह जाती है। सीट 33 पर एक लेखक है जो लिखना छोड़ने जा रहा है; सीट 36 पर एक फ़ोटोग्राफ़र जो हर चीज़ को भूल जाने से पहले सँभाल लेना चाहती है। बारिश, दो कुल्हड़ चाय और एक पूरी रात — और नाम, जो वे सबसे आख़िर में पूछते हैं।",

  // A second, wider look — used under "About the novel".
  closing:
    "यह एक प्रेम-कहानी है, पर इसमें सबसे ज़्यादा बातें उन बातों की हैं जो कही नहीं गईं: एक फ़ोन जो उठाया नहीं गया, चिट्ठियाँ जो कभी पोस्ट नहीं हुईं, एक सवाल जो किसी ने पूछा नहीं, और एक डायरी का ख़ाली आख़िरी पन्ना। रात की इस एक मुलाक़ात से ग्यारह साल निकलते हैं — बनारस के घाटों, बेंगलुरु की बारिश, लखनऊ के स्टेशन और हर महीने की बारह तारीख़ तक।",

  epigraph: {
    text:
      "कुछ लोग हमारी ज़िंदगी में हमेशा रहने नहीं आते। वे हमें हमेशा के लिए बदलने आते हैं।",
    from: "दो कुल्हड़ चाय",
  },

  // The line that runs in the moving strip at the top of the page (the
  // line printed on the cover).
  marqueeLine:
    "कुछ मुलाक़ातें अपनी मंज़िल तक नहीं पहुँचतीं… फिर भी पूरी ज़िंदगी साथ चलती हैं।",

  // Rotating pull-quotes for the ticker. Verbatim, context-free, and none of
  // them gives away where the story goes.
  quotes: [
    "रुकी हुई ट्रेनें… रुकी हुई ज़िंदगी से ज़्यादा डरावनी लगती हैं।",
    "अकेले आदमी दो चाय नहीं लेते।",
    "कभी-कभी नाम सबसे आख़िर में जानना चाहिए।",
    "सुबह जल्दी क्यों नहीं आती?",
    "ट्रेनें लोगों को लेकर चली जाती हैं। स्टेशन उन्हें याद रखते हैं।",
    "फिर भी हुआ न।",
  ],

  // Back-cover teaser — the closing pitch of the page.
  teaser: {
    beats: ["एक रात।", "साढ़े चार घंटे।", "दो कुल्हड़ चाय।"],
    question: "“एक रात बहुत छोटी होती है।” — “तो एक रात ही बहुत है।”",
    cta: "जानने के लिए पढ़िए",
    ctaBook: "दो कुल्हड़ चाय",
    by: "विनय कुमार तिवारी",
  },

  // The four people of the first night and the chapters that follow it.
  // (Other people — the parents, the old couple, a boy at a ghat — arrive
  // later; they are left for the reader to meet.)
  cast: [
    {
      name: "विवान",
      seat: "सीट 33",
      line:
        "लेखक। उसकी कंपनी मई में बंद हो गई, पर लोन नहीं हुआ; डायरी का आख़िरी पन्ना तीन महीने से ख़ाली है। वह तय करके चला है कि घर पहुँचकर लिखना छोड़ देगा।",
    },
    {
      name: "प्राची",
      seat: "सीट 36",
      line:
        "फ़ोटोग्राफ़र। बैग की ज़िप पर लकड़ी का नन्हा कैमरा, कलाई पर वह घड़ी जो समय बताने के लिए नहीं है। जो चीज़ें बाद में याद आने वाली हों, उन्हें वह पहले से सँभालकर रख लेती है — और अपना नाम सबसे आख़िर में बताती है।",
    },
    {
      name: "छेदी भइया",
      seat: "चाय वाला",
      line:
        "तीस साल से इसी लाइन पर। रेलवे को पता चलने में समय लगता है, चाय वाले को पहले पता चल जाता है। और उसे पता है कि अकेले आदमी दो चाय नहीं लेते।",
    },
    {
      name: "राघव",
      seat: "बेंगलुरु",
      line:
        "कॉलेज का दोस्त, फिर रूममेट। झूठ सुनकर पहचान लेता है, और सच सबसे पहले वही बोलता है — बिना सजाए। मैगी के दो पैकेट इसलिए लाता है कि “आदत है।”",
    },
  ],

  themes: [
    {
      n: "01",
      t: "वादा",
      d: "एक ऐसा वादा जो एक बार किया गया और महीने-दर-महीने निभाया गया — वही बारह तारीख़, वही ट्रेन, दो कुल्हड़, चाहे दोनों आ पाएँ या नहीं।",
    },
    {
      n: "02",
      t: "नाम, सबसे आख़िर में",
      d: "दो अजनबी, जो अपना नाम बताने से पहले अपनी सबसे भारी सच्चाइयाँ एक-दूसरे को सौंप देते हैं — क्योंकि नाम जान लेने के बाद इंसान को देखना बंद हो जाता है।",
    },
    {
      n: "03",
      t: "ठहराव",
      d: "एक लाल सिग्नल, साढ़े चार घंटे का रुकना, बारिश। रुकी हुई ट्रेनें रुकी हुई ज़िंदगी से ज़्यादा डरावनी लगती हैं — और फिर एक रात वही रुकाव वह जगह बन जाता है जहाँ ज़िंदगी चल पड़ती है।",
    },
    {
      n: "04",
      t: "भूल जाने का डर",
      d: "एक कैमरा, एक डायरी, एक रिकॉर्डर, एक घड़ी जो समय बताने के लिए नहीं, याद दिलाने के लिए पहनी गई है — सब कुछ इसलिए कि कुछ भी धुँधला न पड़े।",
    },
    {
      n: "05",
      t: "अनकहा",
      d: "वह फ़ोन जो उठाया नहीं गया, वह चिट्ठी जो कभी पोस्ट नहीं हुई, वह सवाल जो किसी ने नहीं पूछा — “तुम ठीक हो?” — और उस चुप्पी ने जो लौटाया।",
    },
    {
      n: "06",
      t: "घर",
      d: "वे पिता जो बस इतना पूछते हैं “सब ठीक है?”, वे माँएँ जो थाली में एक रोटी और रख देती हैं — वह प्रेम जो पूरा वाक्य कभी नहीं कहता।",
    },
  ],
};

/* ---------------------------------------------------------------------------
   प्रस्तावना — the novel's own first page, word for word.
   The book opens with a four-line prologue ("दूसरा टिकट") and then the first
   chapter. This is those, trimmed to the first scene — a hook that asks a
   question and answers nothing.
   --------------------------------------------------------------------------- */
export const OPENING = {
  kicker: "प्रस्तावना · पहला पन्ना",
  stamp: "12 जुलाई 2015 · रविवार · शाम 6:32 बजे · नई दिल्ली रेलवे स्टेशन",
  lines: [
    {
      t: "एक आदमी है, जो हर महीने की बारह तारीख़ को एक ट्रेन में चढ़ता है।\nवह हर बार दो टिकट लेता है।\nऔर वह हमेशा अकेला सफ़र करता है।",
      kind: "hi",
    },
    {
      t: "यह किताब यह बताने के लिए लिखी गई है कि दूसरा टिकट किसका है।",
      kind: "note",
    },
    {
      t: "बारिश कभी अचानक नहीं होती… पहले बहुत देर तक बादल चुप रहते हैं।",
    },
    {
      t: "अगर उस रात शिवगंगा एक्सप्रेस समय पर बनारस पहुँच गई होती, तो शायद मैं आज भी यह मानकर जी रहा होता कि कुछ लोग सिर्फ़ सफ़र में मिलते हैं।",
    },
    {
      t: "ग्यारह साल हो गए। मैं अब भी उसी ट्रेन में चढ़ता हूँ।",
    },
    {
      t: "पर उस शाम मुझे कुछ नहीं पता था।\nउस शाम मेरे पास एक टिकट था, एक बैग था, और एक फ़ैसला — जो घर पहुँचकर करना था।",
    },
    {
      t: "नए कागज़ की ख़ुशबू मुझे हमेशा किसी वादे जैसी लगती थी। जैसे हर नई किताब कह रही हो— “इस बार शायद कहानी अच्छी होगी।”",
      kind: "note",
    },
    {
      t: "“भइया, आपकी अपनी किताब कब आ रही है?”\nमैं वहीं जम गया।",
    },
    {
      t: "“जो पढ़ने वाले होते हैं, वे ख़रीदते हैं। जो लिखने वाले होते हैं, वे नापते हैं।”",
      kind: "hi",
    },
    {
      t: "उसने टिकट मेरी तरफ़ बढ़ाया। “सीट नंबर छत्तीस… यहीं है?”",
      kind: "end",
    },
  ],
};

/* ---------------------------------------------------------------------------
   पंक्तियाँ — lines from the novel that stand on their own.
   Word for word, in the order the book gives them. Chosen to carry its voice
   without carrying its plot.
   --------------------------------------------------------------------------- */
export const LINES = [
  "नए कागज़ की ख़ुशबू मुझे हमेशा किसी वादे जैसी लगती थी।",
  "वह घड़ी नहीं थी। वह उनका बचा हुआ समय था।",
  "बस, जो चीज़ें बाद में याद आने वाली हों, उन्हें पहले से सँभालकर रख लेती हूँ।",
  "जो लोग डायरी बीच से खोलते हैं, वे लिख रहे होते हैं। जो आख़िर से खोलते हैं, वे हिसाब कर रहे होते हैं।",
  "जो चीज़ें आवाज़ करती रहती हैं, उनका इलाज लोग करवा लेते हैं। जो चुप हो जाती हैं, उन्हें आदमी साथ लेकर घूमता रहता है।",
  "अकेले आदमी दो चाय नहीं लेते।",
  "दिन के सफ़र और रात के सफ़र में हमेशा एक फ़र्क़ होता है। दिन में लोग बाहर देखते हैं। रात में अपने भीतर।",
  "रुकी हुई ट्रेनें… रुकी हुई ज़िंदगी से ज़्यादा डरावनी लगती हैं।",
  "जिस चीज़ पर हमारा बस नहीं चलता, उसे बार-बार नहीं देखना चाहिए।",
  "इंसान उम्मीद छोड़ने से नहीं थकता। बार-बार उम्मीद करने से थकता है।",
  "नाम जान लेने के बाद हम इंसान को देखना बंद कर देते हैं।",
  "लोग कितनी आसानी से हमारी छोटी-छोटी चीज़ें हमसे छीन लेते हैं।",
  "चार बजे की हवा अलग होती है। इस वक़्त कोई किसी को कुछ साबित नहीं कर रहा होता।",
  "ट्रेनें लोगों को लेकर चली जाती हैं। स्टेशन उन्हें याद रखते हैं।",
  "कुछ लोग चले नहीं जाते… बस हमारी आदतों में बदल जाते हैं।",
  "तीन बार टिकट कटाकर न जा पाना आलस नहीं होता। वह डर होता है — जिसका नाम आदमी को ख़ुद भी नहीं आता।",
  "इसका असली मतलब यह है कि समय के साथ सब धुँधला हो जाता है।",
  "किसी इंसान को जानने में पूरी ज़िंदगी लग जाती है। एक रात बहुत छोटी होती है।",
  "दर्द हुआ, मतलब सच्चा था।",
  "जो लोग कहते हैं कि वे अच्छा नहीं लिख पाते, उनमें से आधे झूठ बोल रहे होते हैं।",
  "ढूँढ़ना और पीछा करना दो अलग बातें हैं।",
  "कुछ लोग हमारी ज़िंदगी में हमेशा रहने नहीं आते। वे हमें हमेशा के लिए बदलने आते हैं।",
  "याददाश्त बेईमान होती है। वह सबसे ज़रूरी चीज़ें सबसे पहले चुराती है।",
  "तू उसके सामने अच्छी नहीं, सच्ची दिखना चाहती है। बेटा, यही प्रेम है। बाकी सब पसंद है।",
];

export const LINE_ATTRIB = "— विनय कुमार तिवारी (दो कुल्हड़ चाय)";

/* --------------------------------------------------------------- author */
// The author's note below is the one printed at the back of the book.
export const AUTHOR = {
  name: "विनय कुमार तिवारी",
  nameRoman: "Vinay Kumar Tiwari",
  kicker: "लेखक के बारे में",

  // One breath, for the front-page listing.
  brief:
    "ग़ाज़ीपुर, उत्तर प्रदेश में पले-बढ़े; आजकल नोएडा में। सॉफ़्टवेयर इंजीनियर — दिन में वे ऐसी दुनिया बनाते हैं जहाँ हर ग़लती पकड़ी जाती है; रात में उस दुनिया के बारे में लिखते हैं जहाँ ऐसा नहीं होता।",

  lines: [
    "विनय कुमार तिवारी ग़ाज़ीपुर, उत्तर प्रदेश में पले-बढ़े और आजकल नोएडा में रहते हैं। इंजीनियरिंग (B.E.) के बाद से वे सॉफ़्टवेयर इंजीनियर हैं — बड़े सिस्टम सोचते, उनका ढाँचा खड़ा करते और उन्हें बनाते हैं। उनकी ज़िद एक ही है: जो बने, उसमें कोई कमी न रहे।",
    "दिन में वे ऐसी दुनिया बनाते हैं जहाँ हर ग़लती पकड़ी जाती है और ठीक कर दी जाती है। रात में वे उस दुनिया के बारे में लिखते हैं जहाँ ऐसा नहीं होता — जहाँ कोई फ़ोन नहीं उठाया गया, कोई ट्रेन छूट गई, किसी का नाम पूछना रह गया, और उसे ठीक करने का कोई तरीक़ा नहीं बचा।",
    "वे उन लोगों के लिए लिखते हैं जिनकी ज़िंदगी में कुछ छूट गया है, और जो उसे किसी से कह नहीं पाए। उनका मानना है कि ऐसी बातें ज़ोर से कहने की नहीं होतीं — उन्हें बस किसी को सुना देना काफ़ी होता है। इसीलिए उनकी कहानियों में लोग बहुत कम बोलते हैं, और चुप्पियाँ बहुत कुछ कहती हैं।",
    "ग़ाज़ीपुर और नोएडा के बीच जितनी दूरी है, लगभग उतनी ही उनके दिन और उनकी रात के बीच है। यह किताब उस दूरी में लिखी गई है — ज़्यादातर उस वक़्त, जब बाक़ी शहर सो चुका होता था।",
  ],

  // A line of the novel, not of the author.
  motto:
    "कुछ लोग हमारी ज़िंदगी में हमेशा रहने नहीं आते। वे हमें हमेशा के लिए बदलने आते हैं।",

  education: [
    { year: "2015", what: "PG-DAC — सी-डैक (C-DAC), पुणे" },
    { year: "2014", what: "B.E., Electronics & Communication Engineering — IIST, इंदौर" },
  ],

  now: [
    { k: "व्यवसाय", v: "सॉफ़्टवेयर इंजीनियर" },
    { k: "निवास", v: "नोएडा · मूल निवास : ग़ाज़ीपुर, उत्तर प्रदेश" },
    { k: "भाषा", v: "लेखन : हिंदी · बोलचाल : हिंदी, अंग्रेज़ी, भोजपुरी" },
  ],

  connect: {
    heading: "लेखक से जुड़ें",
    // The literary address — deliberately separate from the work inbox.
    email: "author.vinaytiwari1@gmail.com",
    website: "https://vinaytiwari.org",
    websiteLabel: "vinaytiwari.org",
    // An empty address draws the icon without a link (see SocialIcons.jsx).
    // The Instagram handle is the one printed in the book's author note.
    social: {
      instagram: "https://www.instagram.com/_vinaytiwari",
      facebook: "", // set to the Facebook address, e.g. https://www.facebook.com/…
      youtube: "", // set to the channel address, e.g. https://www.youtube.com/@…
    },
  },
};

export default BOOK;
