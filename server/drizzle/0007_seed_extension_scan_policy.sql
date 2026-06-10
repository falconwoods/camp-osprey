UPDATE "extension_configs"
SET
	"extraConfig" = jsonb_set(
		COALESCE("extraConfig", '{}'::jsonb),
		'{scanPolicy}',
		'{
			"minIntervalSeconds": 60,
			"maxIntervalSeconds": 300,
			"defaultIntervalSeconds": 120,
			"allowedIntervalSeconds": [60, 120, 180, 300],
			"requestSpacingMs": 2000,
			"maxRequestsPerCycle": 30,
			"maxRequestsPerTripPerCycle": 8,
			"backoff": {
				"errorBaseSeconds": 300,
				"rateLimitBaseSeconds": 600,
				"maxSeconds": 1800
			}
		}'::jsonb,
		true
	),
	"updatedAt" = now()
WHERE NOT (COALESCE("extraConfig", '{}'::jsonb) ? 'scanPolicy');
