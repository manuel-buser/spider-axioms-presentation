;; ============================================================================
;;  Spider domain , axiom-based reformulation
;;
;;  Rewrite of the IPC-2018 Spider domain (Spider_NoAxioms/domain.pddl) using
;;  PDDL :derived-predicates instead of the original simulation of derived
;;  predicates with control-flag fluents and zero-cost propagation actions.
;;
;;  Textbook reference: Haslum, Lipovetzky, Magazzeni, Muise. "An Introduction
;;  to PDDL", Morgan & Claypool 2019, Section 3.2 (pp. 71-74).
;;
;;  What changed vs the no-axioms encoding:
;;    - REMOVED predicates: currently-updating-{movable,unmovable,part-of-tableau},
;;      make-{movable,unmovable,part-of-tableau}.
;;    - REMOVED actions: change-tableau-{and-continue,and-stop},
;;      make-unmovable-{and-continue,and-stop-at-tableau,and-stop-at-unmovable},
;;      make-movable-{and-continue,ignore-pile,and-stop}.
;;    - DERIVED via axioms: movable, part-of-tableau (their truth is recomputed
;;      at every state by stratified fixpoint, no longer stored as fluents).
;;    - REMOVED requirement :conditional-effects.
;;    - ADDED requirements :derived-predicates,
;;      :disjunctive-preconditions, :existential-preconditions.
;;    - All :effect clauses on movable / part-of-tableau / currently-updating-* /
;;      make-* are stripped (no action may modify a derived predicate;
;;      Haslum et al. p. 73).
;;
;;  Cost structure preserved exactly , only start-dealing, move-to-card,
;;  move-to-tableau, start-collecting-deck cost 1; everything else is 0.
;;  So plan cost on a problem instance must equal the cost of the corresponding
;;  no-axioms instance , that's the equivalence test.
;; ============================================================================

(define (domain spider-axioms)

(:requirements
    :typing
    :action-costs
    :negative-preconditions
    :disjunctive-preconditions
    :existential-preconditions
    :derived-predicates
)

(:types
    cardposition - object
    card_or_tableau - cardposition
    card - card_or_tableau
    tableau - card_or_tableau
    deal - cardposition
)

(:constants
    discard - cardposition
)

;; ----------------------------------------------------------------------------
;;  As in the original: each deal-i is represented by a list of cards stacked
;;  on top of deal-i (clear card on top is dealt first). TO-DEAL is static and
;;  redundant with `on`; it pins down which pile each card must go to.
;; ----------------------------------------------------------------------------

(:predicates
    ;; --- primary state predicates (modified by actions) ----------------------
    (on ?c1 - card ?c2 - cardposition)
    (clear ?c - cardposition)
    (in-play ?c - card)
    (current-deal ?d - deal)

    ;; --- phase flags ---------------------------------------------------------
    (currently-dealing)
    (currently-collecting-deck)
    (collect-card ?c - cardposition)

    ;; --- static predicates (set in :init only) -------------------------------
    (CAN-CONTINUE-GROUP ?c1 - card ?c2 - cardposition)
    (CAN-BE-PLACED-ON ?c1 - card ?c2 - card)
    (IS-ACE ?c - card)
    (IS-KING ?c - card)
    (NEXT-DEAL ?d ?nd - deal)
    (TO-DEAL ?c - card ?p - tableau ?d - deal ?next - cardposition)

    ;; --- derived predicates (defined by axioms below) ------------------------
    (movable ?c - card)
    (part-of-tableau ?c - card ?t - tableau)
)

(:functions
    (total-cost) - number
)

;; ============================================================================
;;  AXIOMS
;; ============================================================================

;; A card c is movable iff it is in-play and either:
;;   (a) c is clear (top of its pile), or
;;   (b) some card `above` is directly on top of c, is itself movable,
;;       and forms a same-suit consecutive group with c.
;;
;; Stratification: positive recursion only. Level 1.
(:derived (movable ?c - card)
    (and
        (in-play ?c)
        (or
            (clear ?c)
            (exists (?above - card)
                (and
                    (on ?above ?c)
                    (movable ?above)
                    (CAN-CONTINUE-GROUP ?above ?c)
                )
            )
        )
    )
)

;; part-of-tableau(c, t) is the transitive closure of `on` rooted at tableau t.
;;   Base:      c is directly on the tableau t.
;;   Recursive: c is on some card y, and y is part of t.
;;
;; Stratification: positive recursion only. Level 1.
(:derived (part-of-tableau ?c - card ?t - tableau)
    (or
        (on ?c ?t)
        (exists (?y - card)
            (and
                (on ?c ?y)
                (part-of-tableau ?y ?t)
            )
        )
    )
)

;; ============================================================================
;;  ACTIONS
;; ============================================================================

(:action start-dealing
    :parameters ()
    :precondition
    (and
        (not (currently-collecting-deck))
        (not (currently-dealing))
    )
    :effect
    (and
        (currently-dealing)
        (increase (total-cost) 1)
    )
)

(:action deal-card
    :parameters (?c - card ?from - cardposition ?fromdeal - deal ?to - card ?totableau - tableau)
    :precondition
    (and
        (currently-dealing)
        (not (currently-collecting-deck))
        (current-deal ?fromdeal)
        (TO-DEAL ?c ?totableau ?fromdeal ?from)
        (clear ?c)
        (on ?c ?from)
        (part-of-tableau ?to ?totableau)
        (clear ?to)
    )
    :effect
    (and
        (not (on ?c ?from))
        (on ?c ?to)
        (not (clear ?to))
        (clear ?from)
        (in-play ?c)
    )
)

(:action finish-dealing
    :parameters (?d ?nd - deal)
    :precondition
    (and
        (currently-dealing)
        (not (currently-collecting-deck))
        (current-deal ?d)
        (clear ?d)
        (NEXT-DEAL ?d ?nd)
    )
    :effect
    (and
        (not (currently-dealing))
        (not (current-deal ?d))
        (current-deal ?nd)
    )
)

(:action move-to-card
    :parameters (?c - card ?from - card_or_tableau ?to - card ?totableau - tableau)
    :precondition
    (and
        (not (currently-collecting-deck))
        (not (currently-dealing))
        (movable ?c)
        (in-play ?c)
        (clear ?to)
        (in-play ?to)
        (part-of-tableau ?to ?totableau)
        (CAN-BE-PLACED-ON ?c ?to)
        (on ?c ?from)
    )
    :effect
    (and
        (not (on ?c ?from))
        (on ?c ?to)
        (not (clear ?to))
        (clear ?from)
        (increase (total-cost) 1)
    )
)

(:action move-to-tableau
    :parameters (?c - card ?from - card_or_tableau ?to - tableau)
    :precondition
    (and
        (not (currently-collecting-deck))
        (not (currently-dealing))
        (movable ?c)
        (in-play ?c)
        (clear ?to)
        (on ?c ?from)
    )
    :effect
    (and
        (not (on ?c ?from))
        (on ?c ?to)
        (not (clear ?to))
        (clear ?from)
        (increase (total-cost) 1)
    )
)

(:action start-collecting-deck
    :parameters (?c - card)
    :precondition
    (and
        (not (currently-collecting-deck))
        (not (currently-dealing))
        (clear ?c)
        (IS-ACE ?c)
        (in-play ?c)
    )
    :effect
    (and
        (currently-collecting-deck)
        (collect-card ?c)
        (increase (total-cost) 1)
    )
)

(:action collect-card
    :parameters (?c - card ?nextcard - cardposition ?p - tableau)
    :precondition
    (and
        (currently-collecting-deck)
        (not (currently-dealing))
        (collect-card ?c)
        (on ?c ?nextcard)
        (in-play ?c)
        (part-of-tableau ?c ?p)
        (CAN-CONTINUE-GROUP ?c ?nextcard)
    )
    :effect
    (and
        (not (on ?c ?nextcard))
        (on ?c discard)
        (clear ?nextcard)
        (not (in-play ?c))
        (not (collect-card ?c))
        (collect-card ?nextcard)
    )
)

(:action finish-collecting-deck
    :parameters (?c - card ?nextcard - cardposition ?p - tableau)
    :precondition
    (and
        (currently-collecting-deck)
        (not (currently-dealing))
        (on ?c ?nextcard)
        (collect-card ?c)
        (IS-KING ?c)
        (in-play ?c)
        (part-of-tableau ?c ?p)
    )
    :effect
    (and
        (not (on ?c ?nextcard))
        (on ?c discard)
        (clear ?nextcard)
        (not (in-play ?c))
        (not (collect-card ?c))
        (not (currently-collecting-deck))
    )
)

)
