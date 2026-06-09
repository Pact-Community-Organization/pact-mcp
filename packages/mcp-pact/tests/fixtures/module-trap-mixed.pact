(namespace "free")

(module module-trap-mixed GOVERNANCE
  @doc "Module with multiple traps for line-ordering tests."

  (defcap GOVERNANCE ()
    (enforce-keyset "test-keyset"))

  (defschema row value:decimal)
  (deftable rows:{row})

  (defun bad-add:decimal (a:decimal b:decimal c:decimal)
    ;; TRAP: non-binary +
    (+ a b c))

  (defun bad-enforce:string (k:string)
    ;; TRAP: enforce DB read
    (enforce (> (at 'value (read rows k)) 0.0) "nope")
    "ok")

  (defun bad-shadow:decimal (x:decimal)
    (let ((abs 1.0))
      (+ x abs)))
)
