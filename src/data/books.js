// src/data/books.js
// Literary work. Content in Hindi is authored by Vinay Kumar Tiwari.

export const BOOK = {
  title: "दो कुल्हड़ चाय",
  roman: "Do Kulhad Chai",
  kind: "उपन्यास · Novel",
  language: "हिन्दी",
  status: "Debut novel",
  setting: "कानपुर आउटर → लखनऊ जंक्शन → बनारस",
  span: "2015 — 2024 · नौ साल",
  byline: "विनय कुमार तिवारी",

  logline:
    "एक ट्रेन छह घंटे खड़ी रह जाए, तो उसमें बैठे दो अजनबियों के पास सिर्फ़ दो चीज़ें बचती हैं — बारिश और बातचीत।",

  closing:
    "यह उपन्यास साथ रहने के बारे में नहीं है। यह उस वादे के बारे में है, जो उस इंसान के जाने के बाद भी हर महीने घर से निकाल देता है।",

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
        "वे पूरी रात बात करते हैं। दो कुल्हड़ चाय। नाम सबसे आख़िर में पूछते हैं। सुबह उतरते हैं — बिना नंबर लिए।",
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
        "वे यह निभाते हैं। शादी के बाद भी। उन महीनों में भी, जब देश की सारी ट्रेनें रुक गई थीं।",
    },
    {
      when: "फिर एक बिल्कुल साधारण शाम",
      text:
        "छत से उतारे हुए कपड़े गोद में रखे-रखे, प्राची चली जाती है।",
    },
    {
      when: "अगले महीने की बारह तारीख़",
      text:
        "विवान अकेले उसी डिब्बे में चढ़ता है। चाय वाला बिना पूछे दो कुल्हड़ आगे बढ़ा देता है।",
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
  ],
};

// Additional / upcoming titles — edit freely.
export const OTHER_WRITING = [
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
