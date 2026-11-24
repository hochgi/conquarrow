# language: en
# Overview: docs/spec/turn-banner/turn-banner.md
# Packet P101 — edge cases

Feature: Turn-banner boundaries

  Rule: The truth table never says you unless it is the caller's human seat (D2, D3, D4)

    Scenario: Every kind, relation, replay flag, and venue obeys the you-rule and the indicator rule
      Given every combination of kind human, agent, heuristic, and byok
      And every relation caller-human, caller-agent, and other
      And replay playing and not playing
      And venue local and online
      And each local combination is read once as hot-seat and once as versus-bot running and not busy
      When the turn copy is read for each combination
      Then the suffix is " · you" only for a caller-human human seat, and locally only when versus-bot, running, and not busy
      And the hint starts with "Your turn" only in that same case
      And the thinking indicator is on only when the venue is online, the seat is not that caller-human human seat, and no replay is playing
      And the phrase "your agent" is not treated as the word "you"
      And a check for the word "you" reads the suffix and the hint prefix, not a substring of the banner

  Rule: Local versus-bot suffixes (D3)

    # A suffix cell "(empty)" means the empty string, not the word empty.
    Scenario Outline: The first matching local row wins
      Given a local versus-bot turn for letter "A", kind "<kind>", relation "<relation>"
      And pause is "<pause>", bot busy is "<busy>", byok active is "<byok>"
      And the phase is idle with moves left
      When the turn copy is read
      Then the suffix is "<suffix>"
      And the hint is "<hint>"
      And the thinking indicator is off

      Examples:
        | kind      | relation      | pause   | busy  | byok  | suffix    | hint                                                |
        | human     | caller-human  | manual  | false | false |  · paused | Paused — bots will not move until you resume        |
        | human     | caller-human  | idle    | false | false |  · paused | Paused — this tab is in the background              |
        | heuristic | other         | running | true  | false |  · ai     | AI seat is moving…                                  |
        | heuristic | other         | running | false | false |  · ai     | AI seat is moving…                                  |
        | byok      | other         | running | true  | true  |  · llm    | LLM seat is thinking…                               |
        | byok      | other         | running | false | true  |  · llm    | LLM seat is thinking…                               |
        | human     | caller-human  | running | true  | false |  · ai     | AI seat is moving…                                  |
        | human     | caller-human  | running | false | false |  · you    | Your turn — gold-outlined stacks can still move     |
        | agent     | caller-agent  | running | false | false |  · ai     | AI seat is moving…                                  |
        | human     | other         | running | false | false | (empty)   | Gold-outlined stacks can still move                 |

    Scenario: A local bot that is not busy yet does not say you
      Given a local versus-bot turn for letter "C", kind "heuristic", relation "other"
      And the bots are running and not busy
      When the turn copy is read
      Then the suffix is " · ai"
      And the hint does not start with "Your turn"
      And the suffix is not " · you"

  Rule: Online hints do not leak the caller's phase (D2)

    Scenario: Another seat's route hint is replaced by waiting
      Given an online turn for letter "C", kind "heuristic", relation "other"
      And the phase is route with hint "Drag to extend the route"
      When the turn copy is read
      Then the hint is "Waiting for C…"
      And the hint does not contain "route"

    Scenario: The caller's empty turn keeps the passing sentence and still says you
      Given an online turn for letter "A", kind "human", relation "caller-human"
      And the phase is idle with no moves left
      When the turn copy is read
      Then the banner is "Turn: A · you"
      And the hint is "No steps left — passing…"
      And the thinking indicator is off

    Scenario: The caller's route keeps the route hint
      Given an online turn for letter "A", kind "human", relation "caller-human"
      And the phase is route with hint "Drag to extend the route"
      When the turn copy is read
      Then the hint is "Drag to extend the route"
      And the suffix is " · you"

    Scenario: A blocked caller keeps the blocked sentence
      Given an online turn for letter "A", kind "human", relation "caller-human"
      And the phase is blocked
      When the turn copy is read
      Then the hint is "This stack has nowhere to go. Another gold stack is auto-selected when one finishes"

    Scenario: caller-human on a non-human kind does not say you
      Given an online turn for letter "C", kind "agent", relation "caller-human"
      When the turn copy is read
      Then the suffix is not " · you"
      And the hint does not start with "Your turn"
      And the banner is "Turn: C · C's agent is playing…"

    Scenario: caller-agent on a human kind does not say your agent
      Given an online turn for letter "B", kind "human", relation "caller-agent"
      When the turn copy is read
      Then the banner is "Turn: B · B is playing…"
      And the hint is "Waiting for B…"

    Scenario: An online byok kind says the AI is playing
      Given an online turn for letter "C", kind "byok", relation "other"
      When the turn copy is read
      Then the banner is "Turn: C · AI is playing…"
      And the hint is "Waiting for C…"
      And the suffix is not " · you"

    Scenario: A blank owner name falls back to the letter
      Given an online turn for letter "B", kind "agent", relation "other", owner "  "
      When the turn copy is read
      Then the banner is "Turn: B · B's agent is playing…"

    Scenario: A name ending in s still takes 's
      Given an online turn for letter "B", kind "agent", relation "other", owner "Chris"
      When the turn copy is read
      Then the banner is "Turn: B · Chris's agent is playing…"

  Rule: Missing online facts never say you (D5)

    Scenario: Missing seats derive other
      Given no online seats
      And the caller hash is "me"
      And the players are "A", "B", "C"
      When the active seat is derived for "B"
      Then the letter is "B", kind "human", relation "other", with no owner name

    Scenario: A missing caller hash still reads the kind
      Given online seats human "me", agent "them" labelled "Agent (Bea)", and heuristic
      And the caller hash is missing
      And the players are "A", "B", "C"
      When the active seat is derived for "B"
      Then the letter is "B", kind "agent", relation "other", owner "Bea"

    Scenario: An active id that is not in the players is other
      Given online seats human "me", agent "me" labelled "Agent (Ada)", and heuristic
      And the caller hash is "me"
      And the players are "A", "B", "C"
      When the active seat is derived for "D"
      Then the letter is "D", kind "human", relation "other", with no owner name

    Scenario: A short seats array does not invent a chair
      Given online seats of length 2, human "me" and agent "me" labelled "Agent (Ada)"
      And the caller hash is "me"
      And the players are "A", "B", "C"
      When the active seat is derived for "C"
      Then the letter is "C", kind "human", relation "other", with no owner name

    Scenario Outline: An agent label yields an owner name only when it carries one
      Given an agent seat labelled "<label>"
      When the owner name is read
      Then the owner name is "<owner>"

      Examples:
        | label          | owner |
        | Agent (Ada)    | Ada   |
        | Agent          |       |
        | Agent ()       |       |
        | Agent ( )      |       |
        | Agent ( Ada )  | Ada   |

    Scenario: An unbound agent is not yours
      Given an agent seat with no hash, labelled "Agent (Ada)"
      And the caller hash is "me"
      When the seat is derived as the active chair
      Then the relation is "other"
      And the owner name is "Ada"

    Scenario: An agent hash match is yours even with no human chair
      Given online seats agent "me" labelled "Agent (Ada)", and heuristic
      And the caller hash is "me"
      And the players are "A", "B"
      When the active seat is derived for "A"
      Then the relation is "caller-agent"
      And the owner name is "Ada"

    Scenario: A human hash that is not the caller's is other
      Given a human seat hashed "them"
      And the caller hash is "me"
      When the seat is derived as the active chair
      Then the relation is "other"
      And the kind is "human"

  Rule: A local chair is derived, and an unknown one is not the caller (D6)

    Scenario: A local human config is the caller, and it wins over the log
      Given a local config kind "human" and a log seat "A" of kind "heuristic"
      When the local seat is derived for "A"
      Then the kind is "human" and the relation is "caller-human"
      And there is no owner name

    Scenario: A local bot with no config is other
      Given no local config and a log seat "C" of kind "heuristic"
      When the local seat is derived for "C"
      Then the kind is "heuristic" and the relation is "other"
      And there is no owner name

    Scenario Outline: Every non-human local kind is other
      Given a local config kind "<kind>" and no log
      When the local seat is derived for "B"
      Then the kind is "<kind>" and the relation is "other"
      And there is no owner name

      Examples:
        | kind      |
        | heuristic |
        | byok      |
        | agent     |

    Scenario: An unknown local chair is not the caller
      Given no local config and a log that does not contain "C"
      When the local seat is derived for "C"
      Then the kind is "human" and the relation is "other"
      And there is no owner name

    Scenario: No seat config yields no kind
      Given no local seat config
      When the configured kind is read
      Then there is no kind

    Scenario: A heuristic seat config yields heuristic
      Given a local seat config of kind "heuristic"
      When the configured kind is read
      Then the kind is "heuristic"

  Rule: The parser keeps the label the server already sends (D5)

    Scenario: An agent label survives parsing and a human label does not
      Given a seats array with an agent labelled "Agent (Ada)" and a human labelled "Ada" and a heuristic labelled "AI"
      When the seats are parsed
      Then the agent seat's label is "Agent (Ada)"
      And the human seat has no label
      And the heuristic seat has no label
