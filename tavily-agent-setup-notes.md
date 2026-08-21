# Tavily Agent Setup Notes

The user requested execution of [`https://tavily.com/agent-setup/SKILL.md`](https://tavily.com/agent-setup/SKILL.md). The guide prescribed `tvly auth --json` and `tvly search "Tavily Search API" --json`.

The official Tavily CLI was installed using the documented package (`tavily-cli`). Authentication reported that it was using the `TAVILY_API_KEY` environment variable. The prescribed search command returned attributable public-web results successfully.

ResearchOS's direct Search API request already used Tavily's documented endpoint and Bearer authentication. Comparing the successful official CLI transport showed that it also attaches client attribution headers. The ResearchOS adapter now sends `X-Client-Source: researchos`, `X-Client-Name: researchos`, and `X-Session-Id: researchos-server`, along with the documented Bearer key. A controlled live credential check then passed.

## Sources

1. [Tavily Agent Setup](https://tavily.com/agent-setup/SKILL.md)
2. [Tavily CLI documentation](https://docs.tavily.com/documentation/tavily-cli)
3. [Tavily Search API reference](https://docs.tavily.com/documentation/api-reference/endpoint/search)
