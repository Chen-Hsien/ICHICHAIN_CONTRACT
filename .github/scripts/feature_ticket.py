"""Publish a ticket check using only trusted base code and GitHub API metadata."""
import json
import os
import re
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

CONTEXT = "DoudoChain / feature ticket"
FEATURE = re.compile(r"(?:^|[/_-])(?:feat(?:ure)?s?)(?=[/:(_ -]|$)|^新增功能", re.I)
NONFEATURE = re.compile(r"^(fix|docs|chore|ci|test|refactor|perf|build|style|revert)(?:\([^()\n]+\))?!?:\s", re.I)


def check(pr, repo, commits, issue_lookup):
    title = pr["title"].strip()
    positive = (FEATURE.search(title) or FEATURE.search(pr["head"]["ref"])
                or any(FEATURE.search(label["name"]) or label["name"].lower() == "enhancement"
                       for label in pr["labels"]))
    if not positive and NONFEATURE.match(title):
        if pr["commits"] <= 250 and not any(FEATURE.search(msg) for msg in commits()):
            return "success", "Recognized non-feature change"
    body = re.sub(r"<!--.*?(?:-->|$)", "", pr.get("body") or "", flags=re.S)
    # Only a visible standalone declaration counts. Ignore quotes, examples and code blocks.
    body = re.sub(r"(?ms)^ {0,3}(`{3,}|~{3,})[^\n]*\n.*?(?:^ {0,3}\1[ \t]*$|\Z)", "", body)
    refs = re.findall(r"(?im)^Ticket:[ \t]*(.*?)[ \t\r]*$", body)
    if len(refs) != 1:
        return "failure", "Add one Ticket: " + repo + "#NUMBER line to the PR description"
    match = re.fullmatch(re.escape(repo) + r"#([1-9][0-9]*)", refs[0], re.I)
    if not match:
        return "failure", "Reference an issue in this PR's repository"
    issue = issue_lookup(int(match[1]))
    expected = f"https://github.com/{repo}/issues/{match[1]}".lower()
    if (not issue or "pull_request" in issue or issue.get("state") != "open"
            or issue.get("html_url", "").lower() != expected):
        return "failure", "Ticket must be an existing open issue, not a PR"
    return "success", "Verified open ticket #" + match[1]


def main():
    repo = os.environ["GITHUB_REPOSITORY"]
    token = os.environ["GH_TOKEN"]
    api_base = os.environ["GITHUB_API_URL"] + "/repos/" + repo
    run_url = os.environ["GITHUB_SERVER_URL"] + "/" + repo + "/actions/runs/" + os.environ["GITHUB_RUN_ID"]

    def api(path, data=None):
        req = Request(api_base + path, headers={"Authorization": "Bearer " + token,
                      "Accept": "application/vnd.github+json", "Content-Type": "application/json"},
                      data=None if data is None else json.dumps(data).encode())
        with urlopen(req, timeout=30) as response:
            return json.load(response)

    def pages(path):
        page = 1
        while True:
            batch = api(path + ("&" if "?" in path else "?") + "per_page=100&page=" + str(page))
            yield from batch
            if len(batch) < 100:
                return
            page += 1

    def issue_lookup(number):
        try:
            return api("/issues/" + str(number))
        except HTTPError as exc:
            if exc.code == 404:
                return None
            raise

    def evaluate(number):
        pr = api("/pulls/" + str(number))
        if pr["state"] != "open":
            return
        head = pr["head"]["sha"]
        def post(state, message):
            api("/statuses/" + head, dict(context=CONTEXT, state=state, description=message[:140], target_url=run_url))
        post("pending", "Validating the current PR and ticket")
        try:
            def commits():
                return (c["commit"]["message"].split("\n")[0] for c in pages("/pulls/" + str(number) + "/commits"))
            state, message = check(pr, repo, commits, issue_lookup)
        except Exception:
            post("error", "Could not verify the ticket with GitHub")
            raise
        post(state, message)
        print(f"PR #{number}: {state} - {message}")

    event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text())
    if "pull_request" in event:
        evaluate(event["pull_request"]["number"])
    else:
        changed = (event.get("issue") or {}).get("number")
        for pr in pages("/pulls?state=open"):
            if not changed or re.search(r"(?i)#" + str(changed) + r"\b", pr.get("body") or ""):
                evaluate(pr["number"])


if __name__ == "__main__":
    main()
