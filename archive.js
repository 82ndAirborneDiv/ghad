const moment = require("moment");
const Octokit = require("@octokit/rest");

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
if (!GITHUB_TOKEN) {
  throw new Error("GITHUB_TOKEN environment variable missing.");
}
const octokit = Octokit({
  auth: GITHUB_TOKEN
});

const ORG = process.env.ORG;
if (!ORG) {
  throw new Error("ORG environment variable missing.");
}

const CUTOFF_DAYS = parseInt(process.env.CUTOFF_DAYS || "90");
const CUTOFF = moment().subtract(CUTOFF_DAYS, "days");

const getRepos = () => {
  const options = octokit.search.repos.endpoint.merge({
    q: `user:${ORG} archived:false`
  });
  return octokit.paginate.iterator(options);
};

// https://developer.github.com/v3/#schema
const parseGitHubTimestamp = str => moment(str, moment.ISO_8601);

const getLatestEvent = async repo => {
  const eventResponse = await octokit.activity.listRepoEvents({
    owner: repo.owner.login,
    repo: repo.name
  });
  // filter out certain events
  // https://developer.github.com/v3/activity/events/types/
  const IGNORED_EVENTS = ["ForkEvent", "StarEvent", "WatchEvent"];
  const events = eventResponse.data.filter(
    event => !IGNORED_EVENTS.includes(event.type)
  );
  return events[0];
};

const attrAfter = (dateStr, cutoff) => {
  const date = parseGitHubTimestamp(dateStr);
  return date.isAfter(cutoff);
};

const updatedSince = async (repo, cutoff) => {
  if (attrAfter(repo.updated_at, cutoff)) {
    return true;
  }

  if (attrAfter(repo.pushed_at, cutoff)) {
    return true;
  }

  const latestEvent = await getLatestEvent(repo);
  if (latestEvent) {
    if (attrAfter(latestEvent.created_at, cutoff)) {
      return true;
    }
  }

  return false;
};

const shouldBeArchived = async repo => {
  // always archive "DEPRECATED" repositories
  const description = repo.description || "";
  if (/DEPRECATED/i.test(description)) {
    return true;
  }

  // if anything has happened with the repository since the CUTOFF, skip it
  const recentlyUpdated = await updatedSince(repo, CUTOFF);
  return !recentlyUpdated;
};

const archiveRepo = repo => {
  return octokit.repos.update({
    owner: repo.owner.login,
    repo: repo.name,
    archived: true
  });
};

const archiveIfStale = async repo => {
  const archive = await shouldBeArchived(repo);
  if (archive) {
    if (process.env.FOR_REAL) {
      await archiveRepo(repo);
      console.log(`Archived ${repo.html_url}`);
    } else {
      console.log(`Would archive ${repo.html_url}`);
    }
  }
};

const archiveStaleRepos = async () => {
  const repoSearch = getRepos();
  for await (const response of repoSearch) {
    for (const repo of response.data) {
      // don't wait for this to happen
      archiveIfStale(repo);
    }
  }
};

archiveStaleRepos();
