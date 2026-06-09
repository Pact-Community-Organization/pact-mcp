(namespace "free")

(module module-trap-bare-pact-id GOVERNANCE
  @doc "Module demonstrating bare pact-id guard trap"

  (defcap GOVERNANCE ()
    (enforce-keyset "test-keyset"))

  (defpact xchain (sender:string receiver:string amount:decimal)
    (step
      (let ((id (pact-id)))
        "debit step"))
    (step
      ;; [Developer] TRAP: bare pact-id used as sole guard.
      (enforce (= (pact-id) "expected-id") "bad guard")))
)
