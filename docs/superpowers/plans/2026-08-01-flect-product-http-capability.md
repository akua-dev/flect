# Product HTTP capability implementation plan

1. Define strict shared request, response, policy, and sanitized failure
   schemas.
2. Test denials before transport, private credential injection, bounded
   responses, cancellation/deadline behavior, and safe output projection.
3. Implement the provider-neutral Effect adapter and browser transport layer.
4. Wire named operations into the capsule and App-Agent capability registry.
5. Add a browser fixture and native-contract proof, document the adoption path,
   update GitHub issue #7, and run the complete gate.
