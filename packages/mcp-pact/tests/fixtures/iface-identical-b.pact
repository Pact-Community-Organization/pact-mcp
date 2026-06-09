(module iface-identical GOVERNANCE
  @doc "Identical twin for unchanged diff testing"

  (defcap GOVERNANCE () true)

  (defun foo:string (x:integer)
    "foo")

  (defun bar:string ()
    "bar")
)
