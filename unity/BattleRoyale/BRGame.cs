using System.Collections.Generic;
using UnityEngine;

// ---------------------------------------------------------------------------
//  BATTLE ROYALE — single-file, zero-asset prototype
//
//  SETUP
//   1. Empty scene -> empty GameObject -> add this component (BRGame).
//   2. Press Play. Everything else (camera, sun, map, bots, UI) is generated.
//   3. No prefabs, no models, no packages required.
//
//  CONTROLS
//   Desktop : WASD move, hold RMB + mouse to look, LMB fire, R reload,
//             H heal, Space jump.
//   Mobile  : left half = virtual stick, right half = look, FIRE button,
//             plus RELOAD / HEAL / JUMP buttons.
//
//  Everything lives in this one file so it can be dropped into any project.
// ---------------------------------------------------------------------------

/// <summary>Per-actor runtime state. Added by BRGame.SpawnActor, not by hand.</summary>
public class BRActor : MonoBehaviour
{
    public CharacterController controller;
    public Transform visual;
    public bool isPlayer;
    public bool alive = true;
    public float health = 100f;
    public float thinkTimer;
    public float shotTimer;
    public int strafeDirection = 1;
    public BRActor target;
}

public class BRGame : MonoBehaviour
{
    [Header("Match")]
    public int botCount = 15;
    public float mapSize = 160f;
    public float matchDuration = 240f;

    [Header("Player")]
    public float movementSpeed = 6f;
    public float lookSensitivity = 0.13f;

    [Header("Weapon")]
    public int magazineSize = 30;
    public float fireInterval = 0.11f;
    public float reloadDuration = 1.7f;
    public float weaponRange = 120f;

    [Header("Bots")]
    public float botSpeed = 3.8f;
    public float botSightRange = 48f;
    public float botFireRange = 42f;
    public float botAccuracy = 0.62f;

    Transform world;
    Camera cam;
    BRActor player;

    readonly List<BRActor> actors = new List<BRActor>();
    readonly List<Loot> loot = new List<Loot>();
    readonly List<Rect> buildings = new List<Rect>();

    Material groundMat, wallMat, roofMat, playerMat;
    Material botMat, darkMat, ammoMat, medicalMat, zoneMat;

    LineRenderer zone;
    LineRenderer tracer;

    Vector2 movement;
    Vector2 joystickOffset;

    float yaw, pitch = 13f;
    float timer, zoneRadius, nextShot, reloadRemaining;
    float tracerRemaining, damageFlash, toastRemaining;
    float verticalVelocity;

    int ammo, reserve, medkits, kills;
    int moveFinger = -1, lookFinger = -1;

    bool firing, jumpRequested, finished;
    string result = "", toast = "";

    // UI uses a virtual 960 x 540 coordinate system.
    readonly Rect joystickRect = new Rect(28, 330, 170, 170);
    readonly Rect fireRect = new Rect(810, 365, 110, 110);
    readonly Rect reloadRect = new Rect(690, 435, 100, 52);
    readonly Rect jumpRect = new Rect(825, 290, 90, 55);
    readonly Rect healRect = new Rect(690, 365, 100, 52);
    readonly Rect restartRect = new Rect(355, 300, 250, 60);

    struct Loot
    {
        public GameObject obj;
        public bool medical;
    }

    // ------------------------------------------------------------------ setup

    void Start()
    {
        Application.targetFrameRate = 60;
        Screen.sleepTimeout = SleepTimeout.NeverSleep;
        Screen.orientation = ScreenOrientation.LandscapeLeft;

        groundMat = MakeMaterial(new Color(.27f, .39f, .25f));
        wallMat = MakeMaterial(new Color(.59f, .56f, .48f));
        roofMat = MakeMaterial(new Color(.30f, .35f, .39f));
        playerMat = MakeMaterial(new Color(.12f, .62f, .95f));
        botMat = MakeMaterial(new Color(.88f, .32f, .18f));
        darkMat = MakeMaterial(new Color(.12f, .15f, .18f));
        ammoMat = MakeMaterial(new Color(1f, .75f, .12f));
        medicalMat = MakeMaterial(new Color(.15f, .95f, .45f));

        zoneMat = MakeMaterial(new Color(.12f, .75f, 1f, .8f));

        cam = Camera.main;
        if (!cam)
        {
            GameObject cameraObject = new GameObject("BR Camera");
            cam = cameraObject.AddComponent<Camera>();
            cameraObject.AddComponent<AudioListener>();
            cameraObject.tag = "MainCamera";
        }

        cam.fieldOfView = 68;
        cam.nearClipPlane = .1f;
        cam.farClipPlane = 260;
        cam.clearFlags = CameraClearFlags.SolidColor;
        cam.backgroundColor = new Color(.55f, .75f, .85f);

        if (!FindObjectOfType<Light>())
        {
            Light sun = new GameObject("Sun").AddComponent<Light>();
            sun.type = LightType.Directional;
            sun.intensity = 1.2f;
            sun.transform.rotation = Quaternion.Euler(45, -35, 0);
        }

        RenderSettings.ambientLight = new Color(.65f, .69f, .74f);
        RenderSettings.fog = true;
        RenderSettings.fogColor = new Color(.65f, .77f, .83f);
        RenderSettings.fogMode = FogMode.Linear;
        RenderSettings.fogStartDistance = 100;
        RenderSettings.fogEndDistance = 230;

        StartMatch();
    }

    Material MakeMaterial(Color color)
    {
        Shader shader = Shader.Find("Standard");
        if (!shader) shader = Shader.Find("Universal Render Pipeline/Lit");
        if (!shader) shader = Shader.Find("Sprites/Default");

        Material material = new Material(shader);
        material.color = color;
        return material;
    }

    void StartMatch()
    {
        if (world)
        {
            world.gameObject.SetActive(false);
            Destroy(world.gameObject);
        }

        actors.Clear();
        loot.Clear();
        buildings.Clear();

        world = new GameObject("Generated Battle Arena").transform;

        timer = 0;
        zoneRadius = mapSize * .46f;
        ammo = magazineSize;
        reserve = 150;
        medkits = 3;
        kills = 0;
        nextShot = reloadRemaining = tracerRemaining = 0;
        verticalVelocity = 0;
        damageFlash = 0;
        toastRemaining = 0;
        yaw = 0;
        pitch = 13;
        finished = false;
        result = "";
        toast = "";
        ClearInput();

        GenerateMap();

        player = SpawnActor(new Vector3(0, .1f, -15), true);

        for (int i = 0; i < botCount; i++)
        {
            Vector3 position = FindSpawnPoint();
            for (int attempt = 0; attempt < 40 &&
                 Vector3.Distance(position, player.transform.position) < 20;
                 attempt++)
            {
                position = FindSpawnPoint();
            }

            SpawnActor(position, false);
        }

        for (int i = 0; i < 24; i++)
        {
            Vector3 position = FindSpawnPoint();
            position.y = .5f;
            bool medical = i % 3 == 0;

            GameObject item = CreateBox(
                medical ? "Medical Supply" : "Ammo Supply",
                position,
                new Vector3(.65f, .65f, .65f),
                medical ? medicalMat : ammoMat,
                world
            );

            Collider itemCollider = item.GetComponent<Collider>();
            if (itemCollider) itemCollider.enabled = false;
            loot.Add(new Loot { obj = item, medical = medical });
        }

        zone = CreateLine("Safe Zone", zoneMat, .35f);
        zone.loop = true;
        zone.positionCount = 120;

        tracer = CreateLine("Bullet Tracer", zoneMat, .045f);
        tracer.positionCount = 2;
        tracer.enabled = false;

        UpdateZoneVisual();
        ShowToast("SURVIVE. LAST FIGHTER WINS.", 4);
        UpdateCamera(true);
    }

    GameObject CreateBox(
        string objectName, Vector3 position, Vector3 scale,
        Material material, Transform parent)
    {
        GameObject obj = GameObject.CreatePrimitive(PrimitiveType.Cube);
        obj.name = objectName;
        obj.transform.SetParent(parent, false);
        obj.transform.position = position;
        obj.transform.localScale = scale;
        obj.GetComponent<Renderer>().sharedMaterial = material;
        return obj;
    }

    LineRenderer CreateLine(string objectName, Material material, float width)
    {
        GameObject obj = new GameObject(objectName);
        obj.transform.SetParent(world);

        LineRenderer line = obj.AddComponent<LineRenderer>();
        line.sharedMaterial = material;
        line.startWidth = line.endWidth = width;
        line.useWorldSpace = true;
        return line;
    }

    void GenerateMap()
    {
        CreateBox(
            "Ground", new Vector3(0, -.5f, 0),
            new Vector3(mapSize, 1, mapSize), groundMat, world
        );

        // Solid buildings provide cover; this version has no interiors.
        for (int x = -2; x <= 2; x++)
        {
            for (int z = -2; z <= 2; z++)
            {
                if (x == 0 && z == 0) continue;
                if (Random.value < .17f) continue;

                Vector3 p = new Vector3(
                    x * 25 + Random.Range(-3f, 3f),
                    0,
                    z * 25 + Random.Range(-3f, 3f)
                );

                float width = Random.Range(7f, 12f);
                float depth = Random.Range(7f, 12f);
                float height = Random.Range(4f, 9f);

                buildings.Add(new Rect(
                    p.x - width / 2,
                    p.z - depth / 2,
                    width,
                    depth
                ));

                CreateBox(
                    "Building",
                    p + Vector3.up * height / 2,
                    new Vector3(width, height, depth),
                    wallMat, world
                );

                CreateBox(
                    "Roof",
                    p + Vector3.up * (height + .2f),
                    new Vector3(width + .6f, .4f, depth + .6f),
                    roofMat, world
                );

                // Visual panels on the front wall.
                for (int w = -1; w <= 1; w++)
                {
                    GameObject window = CreateBox(
                        "Window",
                        p + new Vector3(w * 2, 2.8f, -depth / 2 - .03f),
                        new Vector3(1.1f, 1.2f, .05f),
                        darkMat, world
                    );

                    Collider windowCollider = window.GetComponent<Collider>();
                    if (windowCollider) windowCollider.enabled = false;
                }
            }
        }

        // Low cover.
        for (int i = 0; i < 22; i++)
        {
            Vector3 p = FindSpawnPoint();
            if (Vector3.Distance(p, new Vector3(0, 0, -15)) < 5)
                continue;

            float size = Random.Range(1.5f, 3f);
            buildings.Add(new Rect(p.x - size / 2, p.z - size / 2, size, size));

            CreateBox(
                "Cover", new Vector3(p.x, .65f, p.z),
                new Vector3(size, 1.3f, size), roofMat, world
            );
        }
    }

    bool PositionClear(Vector3 position, float margin = 2f)
    {
        foreach (Rect building in buildings)
        {
            Rect expanded = new Rect(
                building.xMin - margin,
                building.yMin - margin,
                building.width + margin * 2,
                building.height + margin * 2
            );

            if (expanded.Contains(new Vector2(position.x, position.z)))
                return false;
        }

        foreach (BRActor actor in actors)
        {
            if (!actor) continue;
            if (Vector3.Distance(actor.transform.position, position) < 3)
                return false;
        }

        return true;
    }

    Vector3 FindSpawnPoint()
    {
        for (int attempt = 0; attempt < 300; attempt++)
        {
            Vector2 point = Random.insideUnitCircle * (mapSize * .40f);
            Vector3 position = new Vector3(point.x, .1f, point.y);
            if (PositionClear(position)) return position;
        }

        return new Vector3(0, .1f, 0);
    }

    BRActor SpawnActor(Vector3 position, bool isPlayer)
    {
        GameObject obj = new GameObject(isPlayer ? "Player" : "Enemy Bot");
        obj.transform.SetParent(world);
        obj.transform.position = position;

        BRActor actor = obj.AddComponent<BRActor>();
        actor.isPlayer = isPlayer;
        actor.health = 100;
        actor.alive = true;
        actor.thinkTimer = Random.Range(0f, .4f);
        actor.shotTimer = Random.Range(.4f, 1.5f);
        actor.strafeDirection = Random.value < .5f ? -1 : 1;

        CharacterController controller = obj.AddComponent<CharacterController>();
        controller.height = 1.85f;
        controller.radius = .35f;
        controller.center = Vector3.up * .93f;
        controller.stepOffset = .35f;
        controller.slopeLimit = 45;
        actor.controller = controller;

        actor.visual = new GameObject("Visual").transform;
        actor.visual.SetParent(obj.transform, false);

        GameObject body = GameObject.CreatePrimitive(PrimitiveType.Capsule);
        body.transform.SetParent(actor.visual, false);
        body.transform.localPosition = new Vector3(0, .94f, 0);
        body.transform.localScale = new Vector3(.63f, .87f, .63f);
        body.GetComponent<Renderer>().sharedMaterial = isPlayer ? playerMat : botMat;

        Collider bodyCollider = body.GetComponent<Collider>();
        if (bodyCollider) bodyCollider.enabled = false;

        // NOTE: parented to the visual, so its position must be local.
        GameObject gun = CreateBox(
            "Rifle", Vector3.zero, new Vector3(.14f, .17f, .85f),
            darkMat, actor.visual
        );
        gun.transform.localPosition = new Vector3(.35f, 1.2f, .4f);

        Collider gunCollider = gun.GetComponent<Collider>();
        if (gunCollider) gunCollider.enabled = false;

        actors.Add(actor);
        return actor;
    }

    // ------------------------------------------------------------------ loop

    void Update()
    {
        if (!player) return;

        float dt = Time.deltaTime;

        damageFlash = Mathf.Max(0, damageFlash - dt);
        toastRemaining = Mathf.Max(0, toastRemaining - dt);
        tracerRemaining -= dt;
        if (tracer) tracer.enabled = tracerRemaining > 0;

        if (finished) return;

        timer += dt;
        ReadInput();
        MovePlayer(dt);

        if (reloadRemaining > 0)
        {
            reloadRemaining -= dt;
            if (reloadRemaining <= 0)
            {
                int amount = Mathf.Min(magazineSize - ammo, reserve);
                ammo += amount;
                reserve -= amount;
            }
        }

        // Align camera before calculating the shooting ray.
        UpdateCamera(false);
        if (firing) FirePlayer();

        foreach (BRActor actor in actors)
        {
            if (!actor || !actor.alive) continue;

            if (!actor.isPlayer)
                UpdateBot(actor, dt);

            float distance = new Vector2(
                actor.transform.position.x,
                actor.transform.position.z
            ).magnitude;

            if (distance > zoneRadius)
                ApplyDamage(actor, (timer > matchDuration ? 18f : 7f) * dt, null);
        }

        zoneRadius = Mathf.Lerp(
            mapSize * .46f, 4f,
            Mathf.Clamp01(timer / Mathf.Max(1, matchDuration))
        );
        UpdateZoneVisual();
        UpdateLoot(dt);

        int alive = AliveCount();

        if (!player.alive)
            Finish("ELIMINATED", "Position #" + (alive + 1));
        else if (alive == 1)
            Finish("VICTORY!", "You are the last survivor.");
    }

    void LateUpdate()
    {
        if (player && !finished)
            UpdateCamera(false);
    }

    void ClearInput()
    {
        movement = Vector2.zero;
        joystickOffset = Vector2.zero;
        moveFinger = lookFinger = -1;
        firing = jumpRequested = false;
    }

    Vector2 ToUI(Vector2 screenPoint)
    {
        return new Vector2(
            screenPoint.x / Screen.width * 960,
            (Screen.height - screenPoint.y) / Screen.height * 540
        );
    }

    // ----------------------------------------------------------------- input

    void ReadInput()
    {
        firing = false;

        if (Input.touchCount > 0)
        {
            bool foundMove = false;
            bool foundLook = false;

            foreach (Touch touch in Input.touches)
            {
                Vector2 point = ToUI(touch.position);
                bool ended = touch.phase == TouchPhase.Ended ||
                             touch.phase == TouchPhase.Canceled;

                if (touch.phase == TouchPhase.Began)
                {
                    if (reloadRect.Contains(point)) Reload();
                    else if (healRect.Contains(point)) Heal();
                    else if (jumpRect.Contains(point)) jumpRequested = true;
                    else if (!fireRect.Contains(point))
                    {
                        if (point.x < 440 && moveFinger == -1)
                            moveFinger = touch.fingerId;
                        else if (lookFinger == -1)
                            lookFinger = touch.fingerId;
                    }
                }

                if (!ended && fireRect.Contains(point) &&
                    touch.fingerId != moveFinger &&
                    touch.fingerId != lookFinger)
                {
                    firing = true;
                }

                if (touch.fingerId == moveFinger)
                {
                    foundMove = !ended;
                    if (ended)
                    {
                        moveFinger = -1;
                        movement = joystickOffset = Vector2.zero;
                    }
                    else
                    {
                        Vector2 delta = point - joystickRect.center;
                        joystickOffset = Vector2.ClampMagnitude(delta, 58);
                        movement = new Vector2(
                            joystickOffset.x, -joystickOffset.y
                        ) / 58;
                    }
                }

                if (touch.fingerId == lookFinger)
                {
                    foundLook = !ended;
                    if (ended) lookFinger = -1;
                    else
                    {
                        float scale = 960f / Screen.width;
                        yaw += touch.deltaPosition.x * scale * lookSensitivity;
                        pitch -= touch.deltaPosition.y * scale * lookSensitivity;
                    }
                }
            }

            if (!foundMove)
            {
                movement = joystickOffset = Vector2.zero;
                moveFinger = -1;
            }
            if (!foundLook) lookFinger = -1;
        }
        else
        {
            moveFinger = lookFinger = -1;
            joystickOffset = Vector2.zero;

            movement = new Vector2(
                Input.GetAxisRaw("Horizontal"),
                Input.GetAxisRaw("Vertical")
            );
            movement = Vector2.ClampMagnitude(movement, 1);

            if (Input.GetMouseButton(1))
            {
                yaw += Input.GetAxis("Mouse X") * 3;
                pitch -= Input.GetAxis("Mouse Y") * 3;
            }

            Vector2 mouse = ToUI(Input.mousePosition);
            bool onButton = fireRect.Contains(mouse) ||
                            reloadRect.Contains(mouse) ||
                            healRect.Contains(mouse) ||
                            jumpRect.Contains(mouse);

            firing = Input.GetMouseButton(0) && !onButton;

            if (Input.GetKeyDown(KeyCode.R)) Reload();
            if (Input.GetKeyDown(KeyCode.H)) Heal();
            if (Input.GetKeyDown(KeyCode.Space)) jumpRequested = true;

            if (Input.GetMouseButton(0) && fireRect.Contains(mouse))
                firing = true;

            if (Input.GetMouseButtonDown(0))
            {
                if (reloadRect.Contains(mouse)) Reload();
                if (healRect.Contains(mouse)) Heal();
                if (jumpRect.Contains(mouse)) jumpRequested = true;
            }
        }

        pitch = Mathf.Clamp(pitch, -25, 65);
    }

    // ---------------------------------------------------------------- player

    void MovePlayer(float dt)
    {
        Quaternion rotation = Quaternion.Euler(0, yaw, 0);
        Vector3 direction = rotation *
            new Vector3(movement.x, 0, movement.y);

        if (player.controller.isGrounded)
        {
            if (verticalVelocity < 0) verticalVelocity = -2;
            if (jumpRequested) verticalVelocity = 7;
        }

        jumpRequested = false;
        verticalVelocity -= 20 * dt;

        player.controller.Move(
            (direction * movementSpeed + Vector3.up * verticalVelocity) * dt
        );

        KeepInsideMap(player);

        if (direction.sqrMagnitude > .01f || firing)
        {
            Quaternion facing = firing
                ? rotation
                : Quaternion.LookRotation(direction);

            player.transform.rotation = Quaternion.Slerp(
                player.transform.rotation, facing, dt * 14
            );
        }
    }

    void UpdateCamera(bool instant)
    {
        Quaternion rotation = Quaternion.Euler(pitch, yaw, 0);
        Vector3 pivot = player.transform.position + Vector3.up * 1.6f;

        Vector3 desired = pivot + rotation * new Vector3(.65f, .3f, -4.5f);
        Vector3 offset = desired - pivot;

        // RaycastAll lets us ignore our own character collider so the camera
        // does not snap onto the player when standing against a wall.
        float distance = offset.magnitude;
        foreach (RaycastHit hit in Physics.SphereCastAll(
            pivot, .18f, offset.normalized, distance,
            ~0, QueryTriggerInteraction.Ignore))
        {
            if (hit.collider.GetComponentInParent<BRActor>() == player) continue;
            distance = Mathf.Min(distance, Mathf.Max(.3f, hit.distance - .1f));
        }

        desired = pivot + offset.normalized * distance;
        cam.transform.position = instant
            ? desired
            : Vector3.Lerp(cam.transform.position, desired, 20 * Time.deltaTime);

        cam.transform.rotation = rotation;
    }

    void FirePlayer()
    {
        if (Time.time < nextShot || reloadRemaining > 0) return;
        if (ammo <= 0)
        {
            Reload();
            return;
        }

        nextShot = Time.time + fireInterval;
        ammo--;

        Ray cameraRay = cam.ViewportPointToRay(new Vector3(.5f, .5f, 0));
        Vector3 aimPoint = cameraRay.GetPoint(weaponRange);

        if (FirstHit(cameraRay.origin, cameraRay.direction,
                     weaponRange, player, out RaycastHit cameraHit))
        {
            aimPoint = cameraHit.point;
        }

        Vector3 origin = player.transform.position +
                         Vector3.up * 1.35f +
                         player.transform.right * .3f;

        Vector3 direction = (aimPoint - origin).normalized;
        direction = Quaternion.Euler(
            Random.Range(-.35f, .35f),
            Random.Range(-.35f, .35f), 0
        ) * direction;

        Vector3 end = origin + direction * weaponRange;

        if (FirstHit(origin, direction, weaponRange, player, out RaycastHit hit))
        {
            end = hit.point;
            BRActor victim = hit.collider.GetComponentInParent<BRActor>();

            if (victim && victim.alive)
            {
                bool headshot = hit.point.y - victim.transform.position.y > 1.5f;
                ApplyDamage(victim, headshot ? 65 : 26, player);
                ShowToast(headshot ? "HEADSHOT" : "HIT", .35f);
            }
        }

        tracer.SetPosition(0, origin);
        tracer.SetPosition(1, end);
        tracerRemaining = .055f;
        tracer.enabled = true;

        pitch = Mathf.Clamp(pitch - .22f, -25, 65);
    }

    /// <summary>Nearest hit along the ray, skipping <paramref name="ignore"/>.</summary>
    bool FirstHit(
        Vector3 origin, Vector3 direction, float range,
        BRActor ignore, out RaycastHit closest)
    {
        closest = default;
        float nearest = range + 1;
        bool found = false;

        foreach (RaycastHit hit in Physics.RaycastAll(
            origin, direction, range, ~0, QueryTriggerInteraction.Ignore))
        {
            BRActor actor = hit.collider.GetComponentInParent<BRActor>();
            if (actor == ignore || (actor && !actor.alive)) continue;

            if (hit.distance < nearest)
            {
                nearest = hit.distance;
                closest = hit;
                found = true;
            }
        }

        return found;
    }

    void Reload()
    {
        if (finished || reloadRemaining > 0 ||
            ammo >= magazineSize || reserve <= 0)
            return;

        reloadRemaining = reloadDuration;
        ShowToast("RELOADING", reloadDuration);
    }

    void Heal()
    {
        if (finished || !player.alive || medkits <= 0 ||
            player.health >= 100)
            return;

        medkits--;
        player.health = Mathf.Min(100, player.health + 50);
        ShowToast("+50 HEALTH", 1);
    }

    // ------------------------------------------------------------------ bots

    void UpdateBot(BRActor bot, float dt)
    {
        bot.thinkTimer -= dt;
        bot.shotTimer -= dt;

        if (bot.thinkTimer <= 0)
        {
            bot.thinkTimer = Random.Range(.35f, .65f);
            bot.target = null;
            float nearest = botSightRange;

            foreach (BRActor candidate in actors)
            {
                if (!candidate || candidate == bot || !candidate.alive) continue;

                float distance = Vector3.Distance(
                    candidate.transform.position, bot.transform.position
                );

                if (distance < nearest)
                {
                    nearest = distance;
                    bot.target = candidate;
                }
            }

            if (Random.value < .18f)
                bot.strafeDirection *= -1;
        }

        Vector3 position = bot.transform.position;
        Vector3 move = Vector3.zero;
        Vector3 face = bot.transform.forward;

        float fromCenter = new Vector2(position.x, position.z).magnitude;
        bool needsZone = fromCenter > zoneRadius - 5;

        if (needsZone)
        {
            move = new Vector3(-position.x, 0, -position.z).normalized;
            face = move;
        }

        if (bot.target && bot.target.alive)
        {
            Vector3 toTarget = bot.target.transform.position - position;
            toTarget.y = 0;
            float distance = toTarget.magnitude;
            Vector3 direction = toTarget.normalized;
            face = direction;

            if (!needsZone)
            {
                move = distance > 18
                    ? direction
                    : Vector3.Cross(Vector3.up, direction) *
                      bot.strafeDirection * .65f;
            }

            Vector3 origin = position + Vector3.up * 1.4f;
            Vector3 targetPoint = bot.target.transform.position + Vector3.up * 1.2f;

            if (distance < botFireRange && bot.shotTimer <= 0)
            {
                bot.shotTimer = Random.Range(.5f, 1.05f);

                if (FirstHit(
                    origin, (targetPoint - origin).normalized,
                    45, bot, out RaycastHit hit))
                {
                    BRActor victim = hit.collider.GetComponentInParent<BRActor>();

                    if (victim == bot.target && Random.value < botAccuracy)
                        ApplyDamage(victim, Random.Range(7f, 13f), bot);
                }
            }
        }
        else if (!needsZone)
        {
            float angle = Time.time * .15f + bot.GetInstanceID();
            move = new Vector3(Mathf.Sin(angle), 0, Mathf.Cos(angle)) * .5f;
            face = move;
        }

        // Simple obstacle steering, not full navigation/pathfinding.
        Vector3 probe = position + Vector3.up * .8f;

        if (move.sqrMagnitude > .01f &&
            FirstHit(probe, move.normalized, 1.8f, bot, out RaycastHit obstacle))
        {
            if (!obstacle.collider.GetComponentInParent<BRActor>())
                move = Quaternion.Euler(0, 85 * bot.strafeDirection, 0) * move;
        }

        bot.controller.Move((move * botSpeed + Vector3.down * 8) * dt);
        KeepInsideMap(bot);

        if (face.sqrMagnitude > .01f)
        {
            bot.transform.rotation = Quaternion.Slerp(
                bot.transform.rotation,
                Quaternion.LookRotation(face),
                dt * 8
            );
        }
    }

    void KeepInsideMap(BRActor actor)
    {
        Vector3 p = actor.transform.position;
        float limit = mapSize * .5f - 1;

        Vector3 correction = new Vector3(
            Mathf.Clamp(p.x, -limit, limit) - p.x,
            0,
            Mathf.Clamp(p.z, -limit, limit) - p.z
        );

        actor.controller.Move(correction);
    }

    // ---------------------------------------------------------------- damage

    void ApplyDamage(BRActor victim, float damage, BRActor attacker)
    {
        if (!victim || !victim.alive) return;

        victim.health = Mathf.Max(0, victim.health - damage);
        if (victim.isPlayer) damageFlash = .18f;

        if (victim.health > 0) return;

        victim.alive = false;
        victim.controller.enabled = false;
        victim.visual.localRotation = Quaternion.Euler(0, 0, 90);
        victim.visual.localPosition = Vector3.up * .2f;

        if (attacker == player && victim != player)
        {
            kills++;
            reserve += 20;
        }
    }

    void UpdateLoot(float dt)
    {
        for (int i = loot.Count - 1; i >= 0; i--)
        {
            Loot item = loot[i];
            if (!item.obj) continue;

            item.obj.transform.Rotate(0, 75 * dt, 0);

            if (player.alive &&
                Vector3.Distance(
                    player.transform.position + Vector3.up * .5f,
                    item.obj.transform.position) < 1.7f)
            {
                if (item.medical)
                {
                    medkits++;
                    ShowToast("+1 MEDKIT", 1);
                }
                else
                {
                    reserve += 60;
                    ShowToast("+60 AMMO", 1);
                }

                Destroy(item.obj);
                loot.RemoveAt(i);
            }
        }
    }

    void UpdateZoneVisual()
    {
        if (!zone) return;

        for (int i = 0; i < zone.positionCount; i++)
        {
            float angle = i * Mathf.PI * 2 / zone.positionCount;
            zone.SetPosition(i, new Vector3(
                Mathf.Cos(angle) * zoneRadius,
                .18f,
                Mathf.Sin(angle) * zoneRadius
            ));
        }
    }

    int AliveCount()
    {
        int count = 0;
        foreach (BRActor actor in actors)
            if (actor && actor.alive) count++;
        return count;
    }

    void ShowToast(string text, float duration)
    {
        toast = text;
        toastRemaining = duration;
    }

    void Finish(string title, string subtitle)
    {
        finished = true;
        firing = false;
        result = title + "\n" + subtitle;
    }

    void OnApplicationFocus(bool focused)
    {
        if (!focused) ClearInput();
    }

    // -------------------------------------------------------------------- UI

    static GUIStyle LabelStyle(int size, FontStyle weight, TextAnchor anchor)
    {
        GUIStyle style = new GUIStyle(GUI.skin.label);
        style.fontSize = size;
        style.fontStyle = weight;
        style.alignment = anchor;
        style.normal.textColor = Color.white;
        return style;
    }

    void OnGUI()
    {
        if (!player || !cam) return;

        EnsureStyles();

        Matrix4x4 previousMatrix = GUI.matrix;
        GUI.matrix = Matrix4x4.TRS(
            Vector3.zero, Quaternion.identity,
            new Vector3(Screen.width / 960f, Screen.height / 540f, 1)
        );

        GUIStyle text = LabelStyle(20, FontStyle.Bold, TextAnchor.UpperLeft);
        GUIStyle center = LabelStyle(20, FontStyle.Bold, TextAnchor.MiddleCenter);
        GUIStyle small = LabelStyle(15, FontStyle.Bold, TextAnchor.UpperLeft);

        // Damage flash.
        if (damageFlash > 0)
        {
            DrawRect(new Rect(0, 0, 960, 540),
                new Color(1, 0, 0, damageFlash * 1.6f));
        }

        DrawRect(new Rect(14, 14, 240, 88), new Color(0, 0, 0, .65f));
        GUI.Label(new Rect(26, 21, 220, 30),
            "ALIVE " + AliveCount() + "    KILLS " + kills, text);

        DrawRect(new Rect(26, 64, 210, 13), new Color(.25f, .25f, .25f));
        DrawRect(new Rect(26, 64, 210 * player.health / 100f, 13),
            player.health < 30 ? Color.red : Color.green);

        GUI.Label(new Rect(26, 80, 220, 24),
            "HP " + Mathf.CeilToInt(player.health), small);

        GUI.Label(new Rect(350, 15, 300, 32),
            "SAFE ZONE  " + Mathf.CeilToInt(zoneRadius) + "m", center);

        GUI.Label(new Rect(740, 18, 210, 35),
            reloadRemaining > 0
                ? "RELOADING..."
                : "AMMO " + ammo + " / " + reserve,
            text);

        float distance = new Vector2(
            player.transform.position.x, player.transform.position.z
        ).magnitude;

        if (distance > zoneRadius && !finished)
        {
            GUI.color = new Color(.3f, .8f, 1);
            GUI.Label(new Rect(290, 90, 380, 35),
                "OUTSIDE SAFE ZONE - MOVE TO CENTRE",
                center);
            GUI.color = Color.white;
        }

        if (toastRemaining > 0 && !finished)
        {
            GUI.color = new Color(1, 1, 1, Mathf.Clamp01(toastRemaining));
            GUI.Label(new Rect(280, 78, 400, 32), toast, center);
            GUI.color = Color.white;
        }

        if (!finished)
        {
            DrawRect(new Rect(350, -2, 260, 12), new Color(0, 0, 0, .5f));
            DrawRect(new Rect(350, -2,
                260 * Mathf.Clamp01(timer / Mathf.Max(1, matchDuration)), 12),
                new Color(.9f, .3f, .3f));

            DrawControls();
        }
        else
        {
            DrawRect(new Rect(0, 0, 960, 540), new Color(0, 0, 0, .55f));
            DrawRect(new Rect(230, 170, 500, 210), new Color(.05f, .08f, .12f, .92f));

            cachedBig.normal.textColor = result.StartsWith("VICTORY")
                ? new Color(.35f, 1f, .5f)
                : new Color(1f, .45f, .35f);

            GUI.Label(new Rect(230, 195, 500, 60), result.Split('\n')[0], cachedBig);
            GUI.Label(new Rect(230, 260, 500, 40),
                result.Contains("\n") ? result.Split('\n')[1] : "", center);

            GUI.Label(new Rect(230, 310, 500, 26),
                "KILLS " + kills + "  -  SURVIVED " + Mathf.CeilToInt(timer) + "s",
                cachedSmall);

            if (Button(restartRect, "PLAY AGAIN"))
                StartMatch();
        }

        GUI.matrix = previousMatrix;
    }

    void DrawControls()
    {
        // Virtual joystick.
        DrawCircle(joystickRect.center, 78, new Color(1, 1, 1, .12f));
        DrawCircle(joystickRect.center + joystickOffset, 30,
            new Color(1, 1, 1, .35f));

        Button(fireRect, "FIRE");
        Button(reloadRect, "RELOAD");
        Button(healRect, "HEAL " + medkits);
        Button(jumpRect, "JUMP");

        GUI.Label(new Rect(690, 492, 240, 26),
            "R reload  -  H heal  -  Space jump", cachedTiny);
    }

    // Static so the object survives between frames; rebuilt only when the
    // skin changes. Creating GUIStyle / Texture objects every OnGUI call is a
    // classic mobile GC-hitch source.
    static GUIStyle cachedText, cachedCenter, cachedSmall, cachedTiny, cachedBig;
    static int cachedSkinId = int.MinValue;

    static void EnsureStyles()
    {
        if (cachedSkinId == GUI.skin.GetInstanceID()) return;

        cachedSkinId = GUI.skin.GetInstanceID();

        cachedText = new GUIStyle(GUI.skin.label);
        cachedText.fontSize = 20;
        cachedText.fontStyle = FontStyle.Bold;
        cachedText.normal.textColor = Color.white;

        cachedCenter = new GUIStyle(cachedText);
        cachedCenter.alignment = TextAnchor.MiddleCenter;

        cachedSmall = new GUIStyle(cachedText);
        cachedSmall.fontSize = 15;

        cachedTiny = new GUIStyle(cachedCenter);
        cachedTiny.fontSize = 14;

        cachedBig = new GUIStyle(cachedCenter);
        cachedBig.fontSize = 42;
    }

    bool Button(Rect rect, string label)
    {
        Vector2 mouse = ToUI(Input.mousePosition);
        bool down = Input.GetMouseButton(0) && rect.Contains(mouse);
        bool touching = false;

        foreach (Touch touch in Input.touches)
        {
            if (touch.phase != TouchPhase.Ended &&
                touch.phase != TouchPhase.Canceled &&
                rect.Contains(ToUI(touch.position)))
            {
                touching = true;
                break;
            }
        }

        DrawRect(rect, down || touching
            ? new Color(1, 1, 1, .38f)
            : new Color(1, 1, 1, .18f));

        GUI.Label(rect, label, cachedText);
        return false; // actions are handled in ReadInput
    }

    static void DrawRect(Rect rect, Color color)
    {
        Texture2D texture = Texture2D.whiteTexture;
        GUI.color = color;
        GUI.DrawTexture(rect, texture);
        GUI.color = Color.white;
    }

    static void DrawCircle(Vector2 centre, float radius, Color color)
    {
        const int segments = 24;
        for (int i = 0; i < segments; i++)
        {
            float angle = i * Mathf.PI * 2 / segments;
            Rect dot = new Rect(
                centre.x + Mathf.Cos(angle) * radius - 6,
                centre.y + Mathf.Sin(angle) * radius - 6,
                12, 12
            );
            DrawRect(dot, color);
        }

        DrawRect(new Rect(centre.x - radius * .55f, centre.y - radius * .55f,
            radius * 1.1f, radius * 1.1f), color * .6f);
    }
}
