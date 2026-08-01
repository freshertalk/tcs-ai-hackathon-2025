// src/data/books.js
// ---------------------------------------------------------------------------
// Literary work. All Hindi content below is authored by Vinay Kumar Tiwari.
// Edit freely — every writing page on the site reads from this file.
// ---------------------------------------------------------------------------

export const BOOK = {
  title: "दो कुल्हड़ चाय",
  roman: "Do Kulhad Chai",
  kind: "उपन्यास · Novel",
  language: "हिन्दी",
  status: "पहला उपन्यास · Debut novel",
  byline: "विनय कुमार तिवारी",
  bylineRoman: "Vinay Kumar Tiwari",

  // Facts shown in the cover / spec block
  facts: [
    { k: "विधा", v: "उपन्यास", hi: true },
    { k: "भाषा", v: "हिन्दी", hi: true },
    { k: "कालखंड", v: "2015 — 2026", hi: false },
    { k: "मार्ग", v: "कानपुर · लखनऊ · बनारस", hi: true },
    { k: "स्थिति", v: "पूर्ण · Complete", hi: false },
    { k: "पंजीकरण", v: "LD-36102/2026-CO", hi: false },
    { k: "दाख़िल", v: "01 अगस्त 2026", hi: true },
    { k: "कॉपीराइट", v: "© 2026 लेखक", hi: true },
  ],

  route: "कानपुर आउटर → लखनऊ जंक्शन → बनारस",
  span: "2015 — 2026 · ग्यारह साल",

  logline:
    "एक ट्रेन छह घंटे खड़ी रह जाए, तो उसमें बैठे दो अजनबियों के पास सिर्फ़ दो चीज़ें बचती हैं — बारिश और बातचीत।",

  premise:
    "शिवगंगा एक्सप्रेस, सीट छत्तीस और सैंतीस। एक रुका हुआ लाल सिग्नल, एक पूरी रात की बातचीत, और एक वादा — हर महीने की बारह तारीख़, उसी डिब्बे में, दो कुल्हड़ चाय। यह उपन्यास उस वादे के ग्यारह साल हैं।",

  closing:
    "यह उपन्यास साथ रहने के बारे में नहीं है। यह उस एक वादे के बारे में है, जिसकी उम्र उस रिश्ते से भी लंबी निकली — इतनी लंबी कि आज भी हर महीने एक तय तारीख़ आती है, और कोई बिना किसी से पूछे घर से निकल पड़ता है।",

  epigraph: {
    text:
      "प्रेम का सबसे सुंदर अंत यह नहीं कि दो लोग हमेशा साथ रहे। सबसे सुंदर अंत यह है कि किसी की कही हुई एक छोटी-सी बात हमें हर महीने की एक तय तारीख़ पर घर से निकाल देती है। और हम जाते हैं — बिना यह पूछे कि वहाँ कोई मिलेगा या नहीं।",
    from: "दो कुल्हड़ चाय",
  },

  // Rotating pull-quotes used in the ticker and the quote band.
  // Kept deliberately context-free — no lines that give away the ending.
  quotes: [
    "हर लाल सिग्नल हमेशा लाल नहीं रहता।",
    "उम्मीद प्रेम से भी बड़ी चीज़ है।",
    "रेलवे में चाय बेचते हैं, साहब… ईमान नहीं।",
    "आज बारह तारीख़ है।",
    "नाम हमने सबसे आख़िर में पूछे थे।",
    "कुछ बातें बोल देने से छोटी हो जाती हैं।",
  ],

  // Two protagonists
  cast: [
    {
      name: "विवान",
      seat: "सीट 36",
      line:
        "लेखक। स्टार्टअप बंद, रिश्ता ख़त्म, बैग में एक डायरी — जिसे वह बनारस में छोड़ आने का मन बना चुका है।",
    },
    {
      name: "प्राची",
      seat: "सीट 37",
      line:
        "उसी दिन भाई की पहली बरसी से लौटी है, और यह बात किसी को नहीं बता पाई। सवाल पूछने में उसे कोई नहीं हरा सकता।",
    },
    {
      name: "छेदी भइया",
      seat: "चाय वाला",
      line:
        "दस साल से इसी लाइन पर। बाल सफ़ेद हो गए, केतली छोटी हो गई — आवाज़ वही है। बिना पूछे दो कुल्हड़ रखता है।",
    },
    {
      name: "राघव",
      seat: "बेंगलुरु",
      line:
        "पुराना रूममेट। सबसे पहले फ़ोन उठाता है, सबसे कम सवाल पूछता है — और अपनी आदतें किसी को नहीं बताता।",
    },
  ],

  // Scroll-driven synopsis. Each card is one beat of the story.
  beats: [
    {
      when: "12 जुलाई 2015 · कानपुर आउटर",
      text:
        "सीट 36 पर विवान है। स्टार्टअप बंद, रिश्ता ख़त्म, खाते में तीन हज़ार रुपये — और बैग में एक डायरी, जिसे वह बनारस में छोड़ आने का मन बना चुका है।",
    },
    {
      when: "उसी डिब्बे में · सीट 37",
      text:
        "प्राची है, जो उसी दिन दिल्ली में अपने भाई की पहली बरसी से लौटी है, और यह बात किसी को नहीं बता पाई।",
    },
    {
      when: "वह पूरी रात",
      text:
        "ट्रेन छह घंटे रुकी रहती है। वे पूरी रात बात करते हैं। दो कुल्हड़ चाय। नाम सबसे आख़िर में पूछते हैं। सुबह उतरते हैं — बिना नंबर लिए।",
    },
    {
      when: "डेढ़ साल बाद · लखनऊ जंक्शन",
      text:
        "एक बुक स्टॉल पर प्राची एक नई किताब उठाती है — और उसमें अपनी वह आदत पढ़ती है जो उसने कभी किसी को नहीं बताई थी।",
    },
    {
      when: "दोबारा मिलने पर",
      text:
        "वे शहर नहीं बदलते। वे एक वादा करते हैं: हर महीने की बारह तारीख़, उसी ट्रेन में, उन्हीं दो सीटों पर, दो कुल्हड़ चाय। और उसमें एक शर्त जोड़ते हैं — जिस महीने कोई न आ पाए, दूसरा फिर भी जाएगा।",
    },
    {
      when: "नौ साल",
      text:
        "वे यह निभाते हैं। शादी के बाद भी। उन महीनों में भी, जब देश की सारी ट्रेनें रुक गई थीं। छेदी भइया अब पूछते नहीं — दो कुल्हड़ अपने आप आ जाते हैं।",
    },
    {
      when: "और फिर",
      text:
        "एक बिल्कुल साधारण शाम आती है, जिसके बाद यह वादा पहले जैसा नहीं रह जाता। पर बारह तारीख़ हर महीने आती रहती है।",
    },
    {
      when: "आगे क्या हुआ",
      text:
        "यह किताब में है। और यहाँ नहीं लिखा जाएगा।",
      end: true,
    },
  ],

  themes: [
    {
      n: "01",
      t: "वादा",
      d: "A promise that outlives the person it was made to — and still gets you out of the house on the twelfth.",
    },
    {
      n: "02",
      t: "अजनबीपन",
      d: "Two strangers who trade their heaviest truths before they trade their names.",
    },
    {
      n: "03",
      t: "ठहराव",
      d: "Six stalled hours on an outer signal. Rain, and conversation — the only two things left.",
    },
    {
      n: "04",
      t: "स्मृति",
      d: "Grief written as ritual: same train, same two seats, two kulhads of tea.",
    },
    {
      n: "05",
      t: "अनकहा",
      d: "They never once used the word love. They met on the twelfth of every month instead.",
    },
    {
      n: "06",
      t: "वापसी",
      d: "Some journeys are made not to arrive, but so that the going itself continues.",
    },
  ],
};

/* --------------------------------------------------------------- author */
export const AUTHOR = {
  name: "विनय कुमार तिवारी",
  nameRoman: "Vinay Kumar Tiwari",
  kicker: "लेखक के बारे में",
  lines: [
    "विनय कुमार तिवारी उत्तर प्रदेश के गाज़ीपुर ज़िले से हैं। इस समय नोएडा में रहते हैं और एक बहुराष्ट्रीय कंपनी में SAP कंसल्टेंट हैं।",
    "दिन में वे ऐसे सॉफ़्टवेयर सिस्टम बनाते हैं जिनमें कोई चूक न रह जाए। रात में वे उन लोगों के बारे में लिखते हैं, जिनसे ज़िंदगी में कहीं कुछ चूक गया।",
    "यह फ़र्क़ उन्हें किसी किताब ने नहीं, यात्राओं ने सिखाया — देर से चलने वाली गाड़ियों ने, प्लेटफ़ॉर्म की उन बेंचों ने जहाँ लोग अपने सबसे निजी फ़ोन कॉल करते हैं, और चाय की उन दुकानों ने जहाँ अजनबी दो मिनट में वह बात कह देते हैं जो अपनों को बरसों नहीं कह पाते।",
    "उनका मानना है कि सबसे बड़ी कहानियाँ असाधारण घटनाओं में नहीं होतीं। वे बहुत साधारण जगहों पर, बहुत साधारण लोगों के पास, चुपचाप पड़ी रहती हैं — और किसी के उठाने का इंतज़ार करती हैं।",
    "दो कुल्हड़ चाय उनका पहला उपन्यास है।",
  ],
  motto:
    "ज़िंदगी हमें शब्द नहीं देती। पहले अनुभव देती है। शब्द तो बस बाद में उन पर पता लिखते हैं।",

  education: [
    { year: "2015", what: "PG-DAC — सी-डैक (C-DAC), पुणे" },
    { year: "2014", what: "B.E., Electronics & Communication Engineering — IIST, इंदौर" },
  ],

  now: [
    { k: "व्यवसाय", v: "SAP कंसल्टेंट, एक बहुराष्ट्रीय कंपनी में" },
    { k: "निवास", v: "नोएडा · मूल निवास : गाज़ीपुर, उत्तर प्रदेश" },
    { k: "भाषा", v: "लेखन : हिंदी · बोलचाल : हिंदी, अंग्रेज़ी, भोजपुरी" },
  ],

  connect: {
    heading: "लेखक से जुड़ें",
    email: "vinay.tiwari.sap@gmail.com",
    website: "https://vinaytiwari.org",
    websiteLabel: "vinaytiwari.org",
  },
};

/* ---------------------------------------------------------- copyright
   Public-facing registration details only.
   The filing receipt also carries a receipt number, a payment transaction
   id, a CIN and the applicant's home address and mobile — none of which
   belong on a public page, so none of them are here.
   ---------------------------------------------------------------------- */
export const COPYRIGHT = {
  heading: "कॉपीराइट · Copyright",
  notice: "© 2026 विनय कुमार तिवारी. सर्वाधिकार सुरक्षित.",
  noticeEn: "All rights reserved.",
  statusLabel: "आवेदन दाख़िल · Application filed",
  office: {
    name: "Copyright Office, Government of India",
    nameHi: "कॉपीराइट कार्यालय, भारत सरकार",
    address:
      "Intellectual Property Bhawan, Plot No. 32, Sector 14, Dwarka, New Delhi 110078",
    url: "https://copyright.gov.in",
  },
  rows: [
    { k: "कृति · Work", v: "दो कुल्हड़ चाय (Do Kulhad Chai)" },
    { k: "आवेदक · Applicant", v: "Vinay Kumar Tiwari" },
    { k: "डायरी सं. · Diary No.", v: "LD-36102/2026-CO" },
    { k: "अनुरोध सं. · Request No.", v: "292470" },
    { k: "प्रपत्र · Form", v: "Form XIV" },
    { k: "दाख़िल · Filed", v: "01 August 2026 · Delhi branch" },
  ],
};

/* ------------------------------------------------------- other writing */
export const OTHER_WRITING = [
  {
    title: "प्लेटफ़ॉर्म नोट्स",
    kind: "गद्य · Short prose",
    d: "देर से चलने वाली गाड़ियाँ, स्टेशन की बेंचें, और वे बातें जो अजनबियों से दो मिनट में कह दी जाती हैं।",
  },
  {
    title: "Notes from the outer signal",
    kind: "Essays · in progress",
    d: "Short-form pieces on railways, small towns, and the arithmetic of leaving.",
  },
  {
    title: "Engineering, in plain Hindi",
    kind: "Long-form · occasional",
    d: "Explaining enterprise software to people who have never opened a terminal.",
  },
];

export default BOOK;
