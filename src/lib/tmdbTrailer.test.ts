import assert from "node:assert/strict";
import test from "node:test";
import {
  getTmdbMovieTrailerYoutubeId,
  selectTmdbYoutubeTrailer,
} from "@/lib/tmdb";

void test("prefers an official YouTube trailer", () => {
  const selected = selectTmdbYoutubeTrailer([
    { key: "teaser", site: "YouTube", type: "Teaser", official: true },
    { key: "fan", site: "YouTube", type: "Trailer", official: false },
    { key: "official", site: "YouTube", type: "Trailer", official: true },
  ]);

  assert.equal(selected, "official");
});

void test("ignores non-YouTube videos", () => {
  const selected = selectTmdbYoutubeTrailer([
    { key: "vimeo", site: "Vimeo", type: "Trailer", official: true },
    { key: "youtube", site: "YouTube", type: "Trailer", official: false },
  ]);

  assert.equal(selected, "youtube");
});

for (const scenario of [
  {
    name: "uses the original-language trailer when English videos are missing",
    english: false,
    language: "ja",
    native: true,
    expected: "yiDODe7B5Bg",
    calls: 3,
  },
  {
    name: "keeps an available English trailer",
    english: true,
    language: "ja",
    native: true,
    expected: "english",
    calls: 1,
  },
  {
    name: "returns null when neither language has a trailer",
    english: false,
    language: "ja",
    native: false,
    expected: null,
    calls: 3,
  },
  {
    name: "does not repeat the same lookup for an English film",
    english: false,
    language: "en",
    native: false,
    expected: null,
    calls: 2,
  },
]) {
  void test(scenario.name, async (t) => {
    const key = process.env.TMDB_API_KEY;
    process.env.TMDB_API_KEY = "test-only-key";
    t.after(() => {
      if (key === undefined) delete process.env.TMDB_API_KEY;
      else process.env.TMDB_API_KEY = key;
    });
    const requests: URL[] = [];
    t.mock.method(globalThis, "fetch", async (input: string) => {
      const url = new URL(input);
      requests.push(url);
      assert.ok(url.pathname.startsWith("/3/movie/32250"));
      if (!url.pathname.endsWith("/videos")) {
        return Response.json({ original_language: scenario.language });
      }
      const english = url.searchParams.get("language") === "en-US";
      return Response.json({
        results: (english ? scenario.english : scenario.native)
          ? [
              {
                key: english ? "english" : "yiDODe7B5Bg",
                site: "YouTube",
                type: "Trailer",
                official: true,
              },
            ]
          : [],
      });
    });
    assert.equal(await getTmdbMovieTrailerYoutubeId(32250), scenario.expected);
    assert.equal(requests.length, scenario.calls);
    if (scenario.calls === 3)
      assert.equal(requests[2]!.searchParams.get("language"), "ja");
  });
}
