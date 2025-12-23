// This file has 3 approved underscore violations in approvals.json

const _privateVar1 = "first";
const _privateVar2 = "second";
const _privateVar3 = "third";

// If you uncomment the line below, ESLint will report an error
// because it exceeds the approved count of 3
// const _privateVar4 = "fourth";

export function doSomething() {
  return _privateVar1 + _privateVar2 + _privateVar3;
}

