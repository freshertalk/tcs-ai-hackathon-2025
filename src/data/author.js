// src/data/author.js
// ---------------------------------------------------------------------------
// The writer's side of the profile. The Hindi text is the author's own
// "लेखक के बारे में" page (book back matter), carried over word for word — edit it here, never
// in the component.
// ---------------------------------------------------------------------------

export const AUTHOR = {
  kicker: "लेखक",
  heading: "एक लेखक के रूप में विनय",
  name: "विनय कुमार तिवारी",
  nameRoman: "Vinay Kumar Tiwari",

  // One line in English so the section reads for non-Hindi visitors too.
  gloss:
    "Raised in Ghazipur, living in Noida. He spends the day building systems where every mistake is caught — and the night writing about the ones where it was not.",

  // The one stubbornness the bio opens with — used as the pull quote.
  motto: "जो बने, उसमें कोई कमी न रहे।",
  mottoGloss: "Whatever gets built, nothing in it should be missing.",

  lines: [
    "विनय कुमार तिवारी ग़ाज़ीपुर, उत्तर प्रदेश में पले-बढ़े और आजकल नोएडा में रहते हैं। इंजीनियरिंग (B.E.) के बाद से वे सॉफ़्टवेयर इंजीनियर हैं — बड़े सिस्टम सोचते, उनका ढाँचा खड़ा करते और उन्हें बनाते हैं। उनकी ज़िद एक ही है: जो बने, उसमें कोई कमी न रहे।",
    "दिन में वे ऐसी दुनिया बनाते हैं जहाँ हर ग़लती पकड़ी जाती है और ठीक कर दी जाती है। रात में वे उस दुनिया के बारे में लिखते हैं जहाँ ऐसा नहीं होता — जहाँ कोई फ़ोन नहीं उठाया गया, कोई ट्रेन छूट गई, किसी का नाम पूछना रह गया, और उसे ठीक करने का कोई तरीक़ा नहीं बचा।",
    "वे उन लोगों के लिए लिखते हैं जिनकी ज़िंदगी में कुछ छूट गया है, और जो उसे किसी से कह नहीं पाए। उनका मानना है कि ऐसी बातें ज़ोर से कहने की नहीं होतीं — उन्हें बस किसी को सुना देना काफ़ी होता है। इसीलिए उनकी कहानियों में लोग बहुत कम बोलते हैं, और चुप्पियाँ बहुत कुछ कहती हैं।",
    "ग़ाज़ीपुर और नोएडा के बीच जितनी दूरी है, लगभग उतनी ही उनके दिन और उनकी रात के बीच है। यह किताब उस दूरी में लिखी गई है — ज़्यादातर उस वक़्त, जब बाक़ी शहर सो चुका होता था।",
  ],

  // The novel lives on its own site now; this site only points to it.
  novel: {
    title: "दो कुल्हड़ चाय",
    roman: "Do Kulhad Chai",
    note: "हिन्दी उपन्यास · Hindi novel",
    href: "https://hindireadersclub.com",
    hrefLabel: "hindireadersclub.com",
  },

  connect: {
    // The literary address is deliberately separate from the SAP/work inbox.
    email: "author.vinaytiwari1@gmail.com",
    website: "https://www.vinaytiwari.org",
    websiteLabel: "www.vinaytiwari.org",
    instagram: "https://www.instagram.com/_vinaytiwari/",
    instagramLabel: "@_vinaytiwari",
  },
};

export default AUTHOR;
