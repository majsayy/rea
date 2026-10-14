import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");

describe("office and crew shell", () => {
  it("follows a sidebar office and a bottom-tab crew layout with original branding", () => {
    for (const label of ["Home", "Schedule", "Customers", "Jobs", "Estimates", "Invoices"]) {
      assert.match(app, new RegExp(`"${label}"`));
    }
    assert.match(app, /class="sidebar"/);
    assert.match(app, /class="bottom-tabs"/);
    assert.match(app, /class="field-tabs"/);
    assert.match(app, /Super Cleaning Bros/);
    assert.match(css, /\.dispatch/);
    assert.doesNotMatch(`${app}\n${css}`, /housecall/i);
    for (const hex of ["#1a73e8", "#0d47a1", "#0070f3", "#0055ff", "#0b63ce"]) {
      assert.equal(css.toLowerCase().includes(hex), false);
    }
  });
});
