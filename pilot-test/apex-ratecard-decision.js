// Apex Field Operations — Rate card + provisional hold decision logic
// DRAFT ONLY, 2026-11-03. Merged pilot-test draft 2026-11-03 — pilot-test only, NOT the live demo.
// No webhook URLs, no secrets, no keys, no payment code in this file.
// The same function text is embedded in the draft customer.html and
// operator.html in this folder so each page works standalone.
//
// GOVERNING RULES (from the 2026-11-01 design draft + 2026-11-02 support outline):
//  - Quote ONLY from the tradesperson's own rate card. A blank card quotes nothing.
//  - Default toggle state: OFF. The tradesperson turns auto-confirm on themselves.
//  - Toggle OFF  -> provisional hold, never a confirmed booking, price Pending Review.
//  - Toggle ON   -> confirm ONLY when ALL gates pass: fixed rate-card price,
//    within working hours, inside service area, capacity available.
//    Any gate failing -> fall back to provisional hold, with the failed gates listed.
//  - Never invent a variable repair price. Never confirm blind.
//  - Spend cap: if an estimate exceeds the customer's cap, stop at the cap and
//    ask for a fresh yes. Do not surprise the customer with a larger bill.

(function (root) {
  'use strict';

  // input: {
  //   autoConfirmOn: boolean,           // tradesperson toggle, default false
  //   priceSource: 'rate_card' | 'none' | 'variable',
  //   fixedPrice: number | null,       // only meaningful when priceSource === 'rate_card'
  //   withinWorkingHours: boolean,
  //   insideServiceArea: boolean,
  //   capacityAvailable: boolean
  // }
  // output: { outcome, bookingStatus, customerWording, failedGates: [] }
  //   outcome: 'CONFIRMED_FIXED' | 'PROVISIONAL_HOLD' | 'PENDING_REVIEW_VARIABLE'
  function decideBooking(input) {
    var inp = input || {};
    var failedGates = [];
    if (inp.priceSource !== 'rate_card' || inp.fixedPrice === null || inp.fixedPrice === undefined) {
      failedGates.push('no_fixed_rate_card_price');
    }
    if (!inp.withinWorkingHours) failedGates.push('outside_working_hours');
    if (!inp.insideServiceArea) failedGates.push('outside_service_area');
    if (!inp.capacityAvailable) failedGates.push('no_capacity');

    if (!inp.autoConfirmOn) {
      return {
        outcome: 'PROVISIONAL_HOLD',
        bookingStatus: 'Pending Review',
        customerWording: "We've held a slot provisionally for you. A tradesperson will confirm it, or offer the next slot, if they can't make it. No firm price yet — that comes after inspection / review.",
        failedGates: failedGates,
        toggleState: 'OFF'
      };
    }

    // Toggle ON: confirm only if every gate passes.
    if (failedGates.length === 0) {
      return {
        outcome: 'CONFIRMED_FIXED',
        bookingStatus: 'Confirmed (fixed rate-card price)',
        customerWording: 'Confirmed at the fixed rate-card price. The tradesperson will attend at the held time.',
        failedGates: [],
        toggleState: 'ON'
      };
    }

    // Toggle ON but a gate failed: fall back, never confirm blind.
    // Variable / missing price is Pending Review on price, with a provisional slot.
    // Missing fixed price is always a price Pending Review, whatever the
    // source claimed — a slot may be held, but no price is confirmed.
    var outcome = failedGates.indexOf('no_fixed_rate_card_price') !== -1
      ? 'PENDING_REVIEW_VARIABLE'
      : 'PROVISIONAL_HOLD';
    return {
      outcome: outcome,
      bookingStatus: 'Pending Review',
      customerWording: "We've held a slot provisionally for you. A tradesperson will confirm it, or offer the next slot, if they can't make it. No firm price yet — that comes after inspection / review.",
      failedGates: failedGates,
      toggleState: 'ON (gate failed, fell back)'
    };
  }

  // spend cap: { estimate: number|null, cap: number|null }
  // Returns { action: 'WITHIN_CAP' | 'STOP_AT_CAP' | 'NO_CAP_SET', wording }
  function checkSpendCap(estimate, cap) {
    if (cap === null || cap === undefined || cap === '') {
      return { action: 'NO_CAP_SET', wording: 'No spend cap was set for this job.' };
    }
    if (estimate === null || estimate === undefined) {
      return { action: 'NO_CAP_SET', wording: 'No estimate to check against the cap yet — price is Pending Review.' };
    }
    if (estimate > cap) {
      return {
        action: 'STOP_AT_CAP',
        wording: 'This job has gone beyond your spend cap of £' + cap + '. The tradesperson will stop and ask for your fresh approval before proceeding further.'
      };
    }
    return { action: 'WITHIN_CAP', wording: 'Estimate £' + estimate + ' is within your spend cap of £' + cap + '.' };
  }

  root.ApexRateCardDecision = { decideBooking: decideBooking, checkSpendCap: checkSpendCap };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = root.ApexRateCardDecision;
  }
})(typeof window !== 'undefined' ? window : globalThis);
