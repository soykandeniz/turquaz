# Turquaz SEO Operations

## Claims policy

Use facts that the restaurant can verify. Do not publish invented ratings, awards, reviews, opening hours, dietary guarantees, or claims that Turquaz is the best restaurant. Search rankings cannot be guaranteed.

## Content standards

- Assign one clear visitor intent and primary query to each page.
- Write original content based on Turquaz food, service, location, and staff knowledge.
- Use one descriptive H1, then H2 and H3 headings in a logical order.
- Link to the relevant menu, reservation, ordering, and catering destination.
- Require descriptive alt text for meaningful images.
- Keep titles distinct and generally under 60 characters where practical.
- Keep meta descriptions distinct and generally between 120 and 160 characters.
- Review prices, menu details, dates, and local information before publishing.
- Update or archive stale pages instead of producing thin keyword variations.

## Initial topic map

| Intent | Suggested primary query | Destination |
| --- | --- | --- |
| Find a Turkish restaurant locally | Turkish restaurant San Francisco | Home page |
| Review dishes and prices | Turkish restaurant menu San Francisco | Menu page |
| Learn and find breakfast | Turkish breakfast San Francisco | Blog article |
| Plan a group meal | Turkish catering San Francisco | Local page |
| Explore the neighborhood | Mission District dining guide | Blog article |
| Learn about cuisine | Turkish dishes and ingredients | Blog article |

## Launch checklist

1. Confirm the canonical hostname redirects to `https://www.turquazsf.com/`.
2. Verify the Cloudflare Worker staging routes and D1 migration.
3. Configure Worker secrets: `CONTENT_API_TOKEN` and `ADMIN_PASSWORD`.
4. Configure the email-only Apps Script with the matching `CONTENT_API_TOKEN` and authorized `SENDER_EMAIL`.
5. Activate Worker routes for `/blog/*`, `/san-francisco/*`, `/sitemap.xml`, and `/robots.txt`.
6. Verify the domain property in Google Search Console and submit `/sitemap.xml`.
7. Connect Search Console to the existing GA4 property.
8. Claim or verify the Google Business Profile; confirm name, address, phone, categories, hours, menu, reservation URL, ordering URL, and current photos.
9. Test homepage and article markup with Google Rich Results Test and Schema.org Validator.
10. Run Lighthouse/PageSpeed mobile checks and inspect key pages in Search Console.

## Measurement cadence

Review Search Console monthly using clicks, impressions, CTR, average position, query, and page. Compare at least 28 days against the previous period. Average position is an aggregate indicator, not an exact universal rank. Record content changes and evaluate them over several weeks rather than reacting to daily movement.

Track GA4 events for reservation CTA clicks, menu views, online-order clicks, catering clicks, and editorial CTA clicks. Never include names, email addresses, phone numbers, reservation notes, or other personal information in analytics events.

## Google Business Profile

Treat the Google Business Profile as the primary local-search channel. The
business name must be exactly the real-world name, `Turquaz`; do not add search
keywords to it. Use `Turkish restaurant` as the primary category when it best
matches the business, then add only accurate secondary categories such as
`Mediterranean restaurant`, `Breakfast restaurant`, `Bakery`, or `Cafe`.

Keep these fields identical to the website and other listings:

- address: 1198 Mission St, San Francisco, CA 94102;
- phone: +1 415-791-0770;
- regular hours and holiday or special hours;
- website: `https://www.turquazsf.com/`;
- menu: `https://www.turquazsf.com/menu`;
- reservations: `https://www.turquazsf.com/#reservation`;
- ordering: `https://order.toasttab.com/online/turquaz`.

Upload current exterior, entrance, dining-room, food, menu, and team photos.
Choose a clear cover photo, review user-uploaded photos, answer genuine Q&A,
publish useful updates, and respond professionally to every review. Ask real
customers for honest reviews without incentives, review gating, or scripted
keywords. Never buy reviews.

Use tagged URLs where the destination supports them, for example
`?utm_source=google&utm_medium=organic&utm_campaign=gbp`, while keeping the
canonical page URL unchanged.

## Search and map accounts

1. Verify the `turquazsf.com` domain property in Google Search Console with a
	 DNS record and submit `https://www.turquazsf.com/sitemap.xml`.
2. Inspect the home, menu, blog index, and two strongest landing pages after
	 launch. Request indexing only for important new or materially updated pages.
3. Link Search Console to GA4 and mark `reservation_complete` as a key event.
4. Create or claim Bing Places and Bing Webmaster Tools; import the verified
	 Google Business Profile when appropriate.
5. Claim Apple Business Connect and verify the same name, address, phone, hours,
	 categories, photos, menu, and website.

## Citations and third-party profiles

Claim only relevant profiles that customers actually use. Prioritize Yelp,
Tripadvisor, Facebook, Instagram, TikTok, Foursquare, and any active Toast,
delivery, catering, or reservation marketplace profiles. Use the same business
name, address, phone, website, menu URL, hours, description, and current photos
everywhere. Remove duplicate listings instead of creating more.

Do not use automated backlink packages, mass directory submissions, paid link
networks, or copied guest posts. Those links are low value and can create spam
and reputation problems.

## Earned local links

The strongest links are editorial and locally relevant. Build pages or offers
that are useful enough to cite, then contact appropriate organizations:

- nearby hotels, event venues, offices, coworking spaces, and concierges;
- San Francisco neighborhood and merchant associations;
- local event calendars, cultural organizations, and Turkish community groups;
- food writers and publications such as local dining guides, when there is a
	genuine opening, menu, chef, cultural, or event story;
- catering clients and event partners that maintain a vendor or partner page.

Links should point to the most relevant destination, not always the homepage.
For example, catering references should link to the catering landing page and a
breakfast feature should link to the breakfast article or menu.

## Monthly review

- Check Search Console indexing, queries, pages, click-through rate, and Core
	Web Vitals; compare at least 28 days with the previous period.
- Review GA4 key events and outbound ordering clicks by source and landing page.
- Audit Business Profile insights, reviews, photos, hours, and listing edits.
- Check top citation profiles for incorrect user-suggested changes or duplicates.
- Publish or materially improve content only when restaurant knowledge, new
	photos, menu changes, events, or customer questions justify it.
- Recheck menu prices, links, holiday hours, structured data, and sitemap output.

## URL and rollback policy

Do not change a published slug casually. If a URL must move, configure a permanent redirect before removing the old URL. Archive removes a Worker page from public queries and the sitemap; use D1 revisions to recover the prior content. Keep the static `robots.txt` and `sitemap.xml` as deployment fallbacks, while the Worker versions become authoritative after route activation.
