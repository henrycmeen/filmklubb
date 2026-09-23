import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { cassetteLabelImage } from "./cassetteArtwork";
import labels from "../data/filmCassetteLabels.json";
import films from "../data/halloweenCatalogue.json";

void test("a new film without mapped artwork still has an image inside its cassette", () => {
  assert.equal(cassetteLabelImage("/cover.webp"), "/cover.webp");
  assert.equal(cassetteLabelImage("/cover.webp", "/still.jpg"), "/still.jpg");
  assert.equal(
    cassetteLabelImage("/cover.webp", "/still.jpg", "/still.jpg"),
    "/cover.webp",
  );
});

void test("vote artwork uses the image fallback and recovers failed stills", () => {
  const source = readFileSync(
    new URL("../components/VhsCaseArtwork.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /const labelImage = cassetteLabelImage\(/);
  assert.match(
    source,
    /if \(labelImage !== coverImage\) setFailedLabel\(labelImage\)/,
  );
});

void test("all ten current Halloween films have packaged cassette stills", () => {
  for (const id of [
    32250, 58405, 27374, 9539, 667216, 2291, 16372, 25623, 16307, 36095,
  ]) {
    const film = films.find((f) => f.id === id)!;
    const label = labels[film.coverImage as keyof typeof labels];
    assert.ok(label, `${film.title} missing printed still`);
    assert.ok(
      existsSync(new URL(`../../public${label}`, import.meta.url)),
      label,
    );
  }
});
