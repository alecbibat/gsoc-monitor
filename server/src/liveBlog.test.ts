import { describe, expect, it } from 'vitest';
import { findLiveBlogUrl, parseLiveBlog } from './liveBlog';

const ENTRY = 'https://www.huffpost.com/entry/live-updates_n_6afac912e4b04eba4d44b5f2';

const page = (ld: unknown) =>
  `<html><head><script type="application/ld+json">{"@graph":[{"@type":"Organization"}]}</script>` +
  `<script type="application/ld+json">${JSON.stringify(ld)}</script></head><body></body></html>`;

describe('parseLiveBlog', () => {
  it('reads the updates newest first, without the pinned filler post', () => {
    const blog = parseLiveBlog(
      page({
        '@type': 'LiveBlogPosting',
        headline: 'Trump Arrives In The Philippines: Live Updates',
        url: ENTRY,
        liveBlogUpdate: [
          { '@type': 'BlogPosting', headline: 'Read More From HuffPost', url: `${ENTRY}/liveblog_aa01`, datePublished: '2026-11-16T09:30:39.544Z' },
          { '@type': 'BlogPosting', headline: 'Older  update', url: `${ENTRY}/liveblog_aa02`, datePublished: '2026-11-16T09:30:51.841Z' },
          { '@type': 'BlogPosting', headline: 'Newest update', url: `${ENTRY}/liveblog_aa03`, datePublished: '2026-11-17T16:09:45.772Z' },
          { '@type': 'BlogPosting', headline: 'Newest update', url: `${ENTRY}/liveblog_aa03`, datePublished: '2026-11-17T16:09:45.772Z' },
          { '@type': 'BlogPosting', headline: 'No link' },
        ],
      })
    );
    expect(blog?.title).toBe('Trump Arrives In The Philippines');
    expect(blog?.url).toBe(ENTRY);
    expect(blog?.items).toEqual([
      { id: 'aa03', title: 'Newest update', url: `${ENTRY}/liveblog_aa03`, publishedAt: Date.parse('2026-11-17T16:09:45.772Z') },
      { id: 'aa02', title: 'Older update', url: `${ENTRY}/liveblog_aa02`, publishedAt: Date.parse('2026-11-16T09:30:51.841Z') },
    ]);
  });

  it('is null for a page without a live blog', () => {
    expect(parseLiveBlog(page({ '@type': 'NewsArticle', headline: 'x' }))).toBeNull();
    expect(parseLiveBlog('<html><script type="application/ld+json">{oops</script></html>')).toBeNull();
  });
});

describe('findLiveBlogUrl', () => {
  it('picks the live-updates entry the homepage links most', () => {
    const other = 'https://www.huffpost.com/entry/live-updates_n_0000000000000000000000aa';
    const html = `<a href="${other}">old</a><a href="${ENTRY}">a</a><a href="${ENTRY}?x=1">b</a>
      <a href="https://www.huffpost.com/entry/some-story_n_6afaa9d3e4b04eba4d44aa36">c</a>`;
    expect(findLiveBlogUrl(html)).toBe(ENTRY);
    expect(findLiveBlogUrl('<a href="https://www.huffpost.com/entry/x_n_1">c</a>')).toBeNull();
  });
});
