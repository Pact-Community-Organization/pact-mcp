(namespace "free")

(module module-trap-plus GOVERNANCE
  @doc "Module demonstrating non-binary + operator trap"

  (defcap GOVERNANCE ()
    (enforce-keyset "test-keyset"))

  (defun bad-sum:decimal (a:decimal b:decimal c:decimal)
    @doc "Demonstrates ternary + operator trap"
    ;; [Developer] This is a TRAP - + operator only accepts 2 args
    (+ a b c))

  (defun good-sum:decimal (a:decimal b:decimal c:decimal)  
    @doc "Correct way to add multiple numbers"
    (+ a (+ b c)))
)