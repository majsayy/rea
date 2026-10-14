import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { findDuplicate } from "../src/domain/duplicates.ts";
import { addressKey } from "../src/domain/normalize.ts";

const garcia = {
  id: "cust_garcia",
  firstName: "Sam",
  lastName: "Garcia",
  phone: "3035550100",
  addressKeys: [
    addressKey({
      line1: "10 Main Street",
      line2: null,
      city: "Erie",
      state: "CO",
      postalCode: "80516",
    }),
  ],
};

const sameFirstName = {
  id: "cust_nguyen",
  firstName: "Sam",
  lastName: "Nguyen",
  phone: "7205550199",
  addressKeys: ["9 pearl street boulder co 80302"],
};

describe("duplicate customers", () => {
  it("matches last name plus phone when the first names differ", () => {
    const match = findDuplicate([garcia, sameFirstName], {
      lastName: "Garcia",
      phone: "(303) 555-0100",
      addressKeys: [],
    });
    assert.deepEqual(match, { id: "cust_garcia", matchedOn: ["phone"] });
  });

  it("matches last name plus a normalized street address", () => {
    const key = addressKey({
      line1: "10 Main St",
      line2: null,
      city: "Erie",
      state: "CO",
      postalCode: "80516",
    });
    const match = findDuplicate([garcia], {
      lastName: "garcia",
      phone: "9705550000",
      addressKeys: [key],
    });
    assert.deepEqual(match, { id: "cust_garcia", matchedOn: ["address"] });
  });

  it("matches O'Brien and Obrien with the same phone", () => {
    const match = findDuplicate(
      [{ id: "cust_obrien", firstName: "Pat", lastName: "O'Brien", phone: "3035550142", addressKeys: [] }],
      { lastName: "Obrien", phone: "303.555.0142", addressKeys: [] },
    );
    assert.equal(match?.id, "cust_obrien");
  });

  it("never matches on first name, phone, or address alone", () => {
    const people = [garcia, sameFirstName];
    assert.equal(
      findDuplicate(people, {
        lastName: "Dale",
        phone: garcia.phone,
        addressKeys: garcia.addressKeys,
      }),
      null,
    );
    assert.equal(
      findDuplicate(people, { lastName: "Nguyen", phone: "0000000000", addressKeys: ["somewhere else"] }),
      null,
    );
    assert.equal(findDuplicate(people, { lastName: "Sam", phone: garcia.phone, addressKeys: [] }), null);
  });
});
