// src/coupons/reasons.js
// Why a coupon code was not accepted, in a sentence a reader understands.

export const COUPON_REASON = {
  unknown: "यह कूपन कोड सही नहीं लगता — लिखावट देखकर फिर कोशिश कीजिए।",
  inactive: "यह कूपन अभी रुका हुआ है।",
  expired: "इस कूपन की अवधि पूरी हो चुकी है।",
  not_started: "यह कूपन अभी शुरू नहीं हुआ है।",
  exhausted: "यह कूपन पूरा इस्तेमाल हो चुका है।",
  used_by_you: "आप यह कूपन पहले ही इस्तेमाल कर चुके हैं।",
  not_eligible: "यह कूपन आपके खाते के लिए नहीं है।",
  wrong_book: "यह कूपन इस किताब के लिए नहीं है।",
  signin: "कूपन लगाने के लिए पहले साइन इन कीजिए।",
  limited: "बहुत ज़्यादा कोशिशें हो गईं — थोड़ी देर बाद फिर कोशिश कीजिए।",
};
