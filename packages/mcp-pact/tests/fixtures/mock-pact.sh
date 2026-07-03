#!/usr/bin/env bash
# Mock pact binary for integration + security tests.
# Deterministic output keyed off the basename of the first argument.
set -e

f="${1:-}"

case "$(basename "$f")" in
  simple.repl)
    echo "Load successful"
    echo "expect: addition: PASS"
    echo "expect: passed 2 tests"
    exit 0
    ;;
  failing.repl)
    echo "Load successful"
    echo "expect-failure: div-zero: PASS"
    exit 0
    ;;
  broken.repl)
    echo "Load failed: syntax error at line 3"
    exit 1
    ;;
  gas-test.repl)
    echo "Load successful"
    echo "Gas: 1234"
    exit 0
    ;;
  batch-1.repl)
    echo "Load successful"
    echo "expect: batch1-a: PASS"
    exit 0
    ;;
  batch-2.repl)
    echo "Load successful"
    echo "expect: batch2-a: PASS"
    exit 0
    ;;
  batch-fail.repl)
    echo "Load failed: runtime error in batch-fail"
    exit 1
    ;;
  gas-probe.repl)
    echo "Load successful"
    echo "transfer: Gas: 500"
    echo "Gas: 700"
    echo "gas-probe: claim = 900"
    exit 0
    ;;
  gas-no-probe.repl)
    echo "Load successful"
    echo "nothing to see here"
    exit 0
    ;;
  *)
    echo "Load failed: unknown fixture $(basename "$f")"
    exit 1
    ;;
esac
