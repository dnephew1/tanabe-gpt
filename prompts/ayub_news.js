// ayub_news.js

const AYUB_NEWS = {
    EVALUATE_NEWS: `
Evaluate the following news post. Return only the word "null" if:
- the news topic was previously talked about;
- if it is not a critical news event;
- if it is US politics news unless something agregious or death;
- update to a news already talked about;
- if it is meare famous people news apart from deaths;
- local news that have very little world impact;

Other posts that are relevant return the word "relevant," for example, but not exclusively:
- critical world news;
- news related to Brazil;

Post:
{post}

Previous posts:
{previous_posts}
        `,
};

module.exports = AYUB_NEWS; 