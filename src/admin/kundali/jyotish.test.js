import { antardashas, cmpYmd, hindiDate, houseOf, mahadashas, pratyantars, progress, realDate, runningOn, signName, todayYmd } from "./jyotish";

// A made-up starting point (nobody's chart): the period at birth is the Moon's, with 6 years 3 months 10 days of it
// still to run on 14 March 1985. The expected dates were worked out by hand with the rule a printed Vimshottari table
// uses (years of 360 days, months of 30; "2.7 years" is 2 years 8 months 12 days), not by this code.
const DASHA = { first: "mo", balance: [6, 3, 10], birth: [1985, 3, 14] };
// as a printed table shows them: on real days
const ends = (rows) => rows.map((r) => `${r.lord} ${realDate(r.to)[2]}/${realDate(r.to)[1]}/${realDate(r.to)[0]}`);

test("signs and houses", () => {
  expect([signName(1), signName(5), signName(12), signName(13)]).toEqual(["मेष", "सिंह", "मीन", "मेष"]);
  // counted from the ascendant's sign: the same sign is the first house, the one before it the twelfth
  expect([houseOf(5, 5), houseOf(4, 5), houseOf(1, 5), houseOf(9, 5), houseOf(10, 5)]).toEqual([1, 12, 9, 5, 6]);
});

test("the nine great periods run from the one at birth, each for its planet's years, on the table's own calendar", () => {
  const list = mahadashas(DASHA);
  expect(list.map((r) => r.lord)).toEqual(["mo", "ma", "ra", "ju", "sa", "me", "ke", "ve", "su"]);
  expect(ends(list)).toEqual(["mo 24/6/1991", "ma 24/6/1998", "ra 24/6/2016", "ju 24/6/2032", "sa 24/6/2051", "me 24/6/2068", "ke 24/6/2075", "ve 24/6/2095", "su 24/6/2101"]);
  // the first one is shown from the birth, though it began before it (ten years before its end)
  expect(list[0].from).toEqual([1985, 3, 14]);
  expect(list[0].atBirth).toBe(true);
  expect(list[0].start).toEqual([1981, 6, 24]);
  expect(list[2].from).toEqual([1998, 6, 24]);
  expect(mahadashas(null)).toEqual([]);
  expect(mahadashas({ first: "xx", balance: [1, 0, 0], birth: [2000, 1, 1] })).toEqual([]);
});

test("the sub-periods and the sub-sub-periods come out as a printed table gives them, to the day", () => {
  const list = mahadashas(DASHA);
  const antars = antardashas(list[2]); // Rahu's eighteen years
  expect(ends(antars)).toEqual(["ra 6/3/2001", "ju 30/7/2003", "sa 6/6/2006", "me 24/12/2008", "ke 12/1/2010", "ve 12/1/2013", "su 6/12/2013", "mo 6/6/2015", "ma 24/6/2016"]);
  expect(ends(antardashas(list[3]))).toEqual(["ju 12/8/2018", "sa 24/2/2021", "me 30/5/2023", "ke 6/5/2024", "ve 6/1/2027", "su 24/10/2027", "mo 24/2/2029", "ma 30/1/2030", "ra 24/6/2032"]);
  // inside Rahu–Sun (324 days): a part of a day at the end of a sub-sub-period counts as a whole day
  expect(ends(pratyantars(antars[6]))).toEqual(["su 29/1/2013", "mo 26/2/2013", "ma 15/3/2013", "ra 3/5/2013", "ju 16/6/2013", "sa 8/8/2013", "me 24/9/2013", "ke 12/10/2013", "ve 6/12/2013"]);
  // every list is unbroken: each part begins where the one before it ended
  for (const rows of [antars, pratyantars(antars[6])]) for (let i = 1; i < rows.length; i++) expect(rows[i].from).toEqual(rows[i - 1].to);
});

test("what is running on a day, and how far through it is", () => {
  const on = runningOn(DASHA, [2013, 2, 1]);
  expect([on.maha.lord, on.antar.lord, on.praty.lord]).toEqual(["ra", "su", "mo"]);
  expect(on.antars.length).toBe(9);
  expect(on.pratys.length).toBe(9);
  // the day a period ends belongs to the next one
  expect(runningOn(DASHA, [2013, 1, 12]).antar.lord).toBe("su");
  expect(runningOn(DASHA, [2013, 1, 11]).antar.lord).toBe("ve");
  expect(runningOn(DASHA, [2016, 6, 24]).maha.lord).toBe("ju");
  // a real 31st is a real day like any other; before the birth nothing runs
  expect(runningOn(DASHA, [2013, 1, 31]).praty.lord).toBe("mo");
  expect(runningOn(DASHA, [1980, 1, 1]).maha).toBeNull();
  expect(progress(on.maha, [2007, 6, 24])).toBeCloseTo(0.5, 3);
  expect(progress(on.maha, [2050, 1, 1])).toBe(1);
  expect(progress(null, [2026, 1, 1])).toBe(0);
});

test("dates in words; a 30th the real month does not have runs on into the next; today is India's day", () => {
  expect(hindiDate([2030, 4, 18])).toBe("18 अप्रैल 2030");
  expect(hindiDate([2038, 2, 30])).toBe("2 मार्च 2038");
  expect(hindiDate([2028, 2, 30])).toBe("1 मार्च 2028");
  expect(realDate([2027, 12, 30])).toEqual([2027, 12, 30]);
  expect(hindiDate(null)).toBe("");
  // … and a day is compared as the real day it is: 1 March 2038 is before a period's end printed as "30 February"
  expect(cmpYmd([2038, 3, 1], [2038, 2, 30])).toBeLessThan(0);
  expect(cmpYmd([2038, 3, 2], [2038, 2, 30])).toBe(0);
  // 20:00 UTC on the 19th is already the 20th in India
  expect(todayYmd(Date.UTC(2026, 10, 19, 20, 0))).toEqual([2026, 11, 20]);
});
