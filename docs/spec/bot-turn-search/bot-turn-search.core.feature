# language: en
# Overview: docs/spec/bot-turn-search/bot-turn-search.md
# Adapter only — local heuristic turn search, not a game rule

Feature: Bot turn search — stride by searching a whole turn
  As a local heuristic seat
  I want the chooser to search sequences of steps ending in endTurn
  So that striding a stack beats shuttling it, when SPEC §3 says it should

  Background:
    Given a GeometryPort and a RulesPort
    And seat Bot is to move

  Rule: The chooseTurn seam

    Scenario: playBotTurn plans with beam-v1
      Given a playing GameState whose active player is Bot
      When playBotTurn runs for Bot
      Then the returned moves equal chooseTurnBeam on that state
      And folding rules.apply over those moves equals the returned state

    Scenario: greedy-v1 and beam-v1 share the ChooseTurn signature
      Given a playing GameState whose active player is Bot
      When chooseTurnGreedy and chooseTurnBeam each run
      Then both return a list of moves
      And each list that is non-empty ends with endTurn or a move that hands the seat or ends the match

    Scenario: Wrong seat or a winner yields an empty plan
      Given a GameState whose active player is not Bot
      When playBotTurn runs for Bot
      Then the returned moves are empty
      And the returned state is the given state

  Rule: Stride falls out of plan search

    Scenario: A 2-stack strides a two-arrow homeward close
      Given Bot has a fresh 2-stack on its own trail
      And a two-arrow run home is legal at count 2 both steps
      And the second arrow is Bot territory so the landing is a close
      And shuttling the pair would not land
      And the close terminal evaluates higher than the shuttle and than passing
      When chooseTurnBeam runs
      Then the plan contains two consecutive count=2 steps along that run
      And the plan does not contain a shuttle

    Scenario: A 4-stack takes three arrows in one turn
      Given Bot has a fresh 4-stack
      And a three-arrow run from that stack is legal
      And the deepest arrow of that run evaluates strictly higher than any shorter prefix
      When chooseTurnBeam runs
      Then the plan moves along that run for three steps before endTurn
      And a leftover pair on the last hop is allowed (count may be 2 or 4)

    Scenario: Splitting wins when two destinations beat one deeper advance
      Given Bot has a fresh 4-stack on its territory
      And two distinct outs are legal at count 2
      And splitting 2+2 evaluates higher than passing or moving the 4-stack one way
      When chooseTurnBeam runs
      Then the plan contains two count=2 steps from that stack onto two distinct outs

  Rule: Box and pass are searched decisions

    Scenario: The bot occupies a lone enemy head's only open exit
      Given enemy E has a 1-stack
      And two of that stack's exits are Bot territory
      And the remaining exit O is open
      And Bot has a 2-stack on Bot territory that can step onto O this turn
      And no competing share or close is available this turn
      When chooseTurnBeam runs
      Then some step of the plan has exit O

    Scenario: endTurn is chosen while steps remain when passing evaluates best
      Given Bot has at least one legal step
      And every stepped complete evaluates worse than endTurn by more than IDLE_SLACK
      When chooseTurnBeam runs
      Then the plan is only endTurn

    Scenario: After a home-pinwheel mill the bot still leaves
      Given the 6-seat generated opening
      And the committed 2026-08-31 P55 playtest first round has been applied
      And the active seat has a legal step
      When chooseTurnBeam runs
      Then some step lands on an arrow that is not that seat's territory

    Scenario: An opening home 3-stack leaves rather than milling the pinwheel
      Given the 6-seat generated opening
      And the active seat has a 3-stack on its home pinwheel
      When chooseTurnBeam runs
      Then some step lands on an arrow that is not that seat's territory

    Scenario: After a 0-share home close past three arrows the bot still leaves
      Given the 6-seat generated opening
      And the active seat has completed one 0-share home mill close
      And that seat holds more than 3 territory arrows
      And that seat's trail is empty
      And every own group stands on own territory
      When chooseTurnBeam runs
      Then some step lands on an arrow that is not that seat's territory

    Scenario: The post-paint plan is an expedition not another home mill close
      Given the 6-seat generated opening
      And the active seat has completed one 0-share home mill close
      And that seat holds more than 3 territory arrows
      And that seat's trail is empty
      And every own group stands on own territory
      And an expedition complete exists inside the beam
      When chooseTurnBeam runs
      Then the plan's terminal has open trail, or a group off own territory, or a share gained
      And the plan does not terminate as a 0-share home mill close

  Rule: Measuring stick

    Scenario: beam-v1 beats greedy-v1 on shuttle rate and count greater than 1
      Given the committed P53 baseline heuristic turn-starts
      When chooseTurnBeam and chooseTurnGreedy each plan them
      Then beam-v1's shuttle rate is below greedy-v1's
      And beam-v1's share of steps with count greater than 1 exceeds greedy-v1's

    Scenario: pnpm bots reports the metric table
      Given the default bots seed set
      When the bots report runs
      Then the table has a row for greedy-v1 and a row for beam-v1
      And each row includes shuttle rate, count>1 share, steps per turn, closes per 100 turns, firstCloseAt, shares at turn 50, and mean applies per turn
