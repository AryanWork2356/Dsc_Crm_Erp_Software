/** One-click payment schedules for quotations (anything can still be edited by hand). */
export const PAYMENT_PRESETS: { label: string; text: string }[] = [
  { label: "50 / 40 / 10 – interiors", text: "50% advance payment; 40% before project handover; 10% within 15 days of final bill. Final billing as per actual quantities." },
  { label: "50 / 50 – fixtures", text: "50% advance payment to start production; 50% before dispatch of the fixtures. Final billing as per actual quantities." },
  { label: "40 / 30 / 20 / 10 – stage-wise", text: "40% advance; 30% on carcass completion; 20% on finishing; 10% on handover. Final billing as per actual quantities." },
];
