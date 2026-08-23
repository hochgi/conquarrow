Feature: The mirrored spawner field — edge cases

  Scenario: The reflection is an involution
    Given a vertex cell within R
    When M is applied twice
    Then the result is the original cell
    And the parity of the cell is preserved

  Scenario: Setup refuses to build an asymmetric field silently
    Given a reflection helper that does not satisfy the involution property
    When a match is built
    Then setup fails loudly
    And no state is returned

  Scenario: The representative is chosen by total id order, not by sign
    Given a vertex v and its mirror m with compareIds(v, m) greater than zero
    When the field is built
    Then both are thinned by the sample taken at m
    And the choice does not depend on which of the two the walk reached first

  Scenario: Order of the walk does not change the field
    Given the vertex window enumerated in total id order
    When the field is built twice from the same seed
    Then the two fields are identical

  Scenario: A different seed gives a different field, still mirrored
    Given two configs differing only in spawnerSeed
    When both fields are built
    Then the two fields differ
    And each one is individually invariant under M

  Scenario: The density table is untouched
    Given the band densities and forces of the previous packet
    When the field is built
    Then every spawner's force is the band force for its radius
    And no test pins the number of spawners in any band

  Scenario: A single seat still gets a field
    Given a match with 1 seat
    When the field is built
    Then the field is invariant under M
    And the home vertex carries a spawner

  Scenario: Anti-grain travel costs double
    Given a stack that has walked k steps in a grain direction
    When it returns to its starting arrow
    Then it has taken exactly 2k further steps
    And the order in which the two anti-grain directions were used does not matter

  Scenario: Every closed walk is balanced
    Given any closed walk on the board
    When its steps are counted by direction
    Then the three counts are equal
    And its length is three times that count
