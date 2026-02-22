function getCardConfigFromDescription(card) {
  const html = card.description;
  if (!html) return null;

  // สร้าง DOM ชั่วคราว
  const wrapper = document.createElement("div");
  wrapper.innerHTML = html;

  // หา <pre><code>
  const codeBlocks = wrapper.querySelectorAll("pre > code");

  for (const code of codeBlocks) {
    const text = code.textContent.trim();

    // ต้องขึ้นต้นด้วย card-config
    if (!text.startsWith("card-config")) continue;

    const jsonText = text.replace(/^card-config/, "").trim();

    try {
      return JSON.parse(jsonText);
    } catch (err) {
      ui.notifications.error("Invalid card-config JSON");
      console.error("Card config parse error:", err);
      return null;
    }
  }

  return null;
}

function normalizeAngle(deg) {
  return deg % 360;
}

function rotatePoint(px, py, cx, cy, angleDeg) {
  const angle = normalizeAngle(angleDeg);
  let invert = 1

  const rad = invert * angle * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const dx = px - cx;
  const dy = py - cy;

  return {
    x: Math.round(cx + dx * cos - dy * sin),
    y: Math.round(cy + dx * sin + dy * cos)
  };
}

function wallDataFromType(type = "wall") {
  switch (type) {
    case "door":
      return { door: 1, ds: 0, sense: 0 };
    case "secret":
      return { door: 2, ds: 0, sense: 0 };
    case "window":
      return { door: 0, ds: 0,  sight: 10,
        light: 10, 
      };
    default:
      return { door: 0, ds: 0, sense: 0 };
  }
}

Hooks.once("ready", () => {
  console.log("Card to Tile | Ready");

  // ดัก drop บน canvas
  const canvasElem = document.getElementById("board");

  canvasElem.addEventListener("drop", async (event) => {

    let data;
    try {
      data = JSON.parse(event.dataTransfer.getData("text/plain"));
    } catch (e) {
      return;
    }

    if (data.type !== "Card") return;

    const card = await fromUuid(data.uuid);
    if (!card) return;

    const scene = canvas.scene;
    if (!scene) return;

    // แปลงตำแหน่ง mouse → canvas
    const position = canvas.stage.worldTransform.applyInverse({
      x: event.clientX,
      y: event.clientY
    });
    // 2. Read card flags
    const config = getCardConfigFromDescription(card);

    const tileWidth = config?.tile?.width ?? 800;
    const tileHeight = config?.tile?.height ?? 1200;

    const [tile] = await canvas.scene.createEmbeddedDocuments("Tile", [{
      texture: {src: card.img},
      x: position.x,
      y: position.y,
      width: tileWidth,
      height: tileHeight,
      rotation: 0,
      hidden: false,
      flags: {
        "card-to-tile": {
          cardUuid: card.uuid,
          originX: position.x,
          originY: position.y,
          cardWidth: tileWidth,
          cardHeight: tileHeight,
          originRotation: 0
        }
      }
    }]);

    if (!Array.isArray(config?.walls)) {return};    
    // 3. Create Walls
    const wallData = config.walls.map(w => ({
      c: [
        tile.x + w.points[0],
        tile.y + w.points[1],
        tile.x + w.points[2],
        tile.y + w.points[3]
      ],
      move: w.blockMovement ?? CONST.WALL_MOVEMENT_TYPES.NORMAL,
      sight: w.blockSight ?? CONST.WALL_SENSE_TYPES.NORMAL,
      light: CONST.WALL_SENSE_TYPES.NORMAL,
      sound: CONST.WALL_SENSE_TYPES.NORMAL,
      ...wallDataFromType(w.type)
    }));

    const createdWalls = await canvas.scene.createEmbeddedDocuments("Wall", wallData);
    // เก็บ wall ids ลง tile.flags
    await tile.setFlag("card-to-tile", "wallIds", createdWalls.map(w => w.id));
    event.preventDefault();
  });

  canvasElem.addEventListener("dragover", (event) => {
    event.preventDefault();
  });

});

Hooks.on("updateTile", async (tile, change) => {
  if (!("x" in change || "y" in change) || !tile.flags['card-to-tile']){
    if(!('rotation' in change)) return;
  }
  const originX = tile.flags['card-to-tile'].originX
  const originY = tile.flags['card-to-tile'].originY
  const originRotation = tile.flags['card-to-tile'].originRotation
  // const width = tile.flags['card-to-tile'].cardWidth
  const width = tile.width
  
  // const height = tile.flags['card-to-tile'].cardHeight
  const height = tile.height

  const wallIds = tile.flags["card-to-tile"]?.wallIds;
  if (!Array.isArray(wallIds) || wallIds.length === 0) return;

  const dx = (change.x ?? originX) - originX;
  const dy = (change.y ?? originY) - originY;

  if (dx === 0 && dy === 0){ 
    if(!('rotation' in change))
    return;
  }

  const updates = wallIds
    .map(id => canvas.scene.walls.get(id))
    .filter(Boolean)
    .map(wall => {
      console.log(wall)
      return ({
      ...wall,
      _id: wall.id,
      c: [
        wall.c[0] + dx,
        wall.c[1] + dy,
        wall.c[2] + dx,
        wall.c[3] + dy
      ]
    })});
  console.log('updates', updates)
  if('rotation' in change){
    //TODO: update rotation
    for(const wall of updates ){
      const cx = tile.x + width / 2;
      const cy = tile.y + height / 2;
      console.log('core x: ', cx)
      console.log('core y: ', cy)
      const point1 = rotatePoint(wall.c[0],wall.c[1],cx,cy, change['rotation']-originRotation)
      const point2 = rotatePoint(wall.c[2],wall.c[3],cx,cy, change['rotation']-originRotation)
      const rotation_c = [
        point1.x,
        point1.y,
        point2.x,
        point2.y
      ]
      wall.c= rotation_c
    }
  }

  if (updates.length > 0) {
    console.log('update')
    await canvas.scene.updateEmbeddedDocuments("Wall", updates);
    await tile.setFlag("card-to-tile", "originX", tile.x);
    await tile.setFlag("card-to-tile", "originY", tile.y);
    await tile.setFlag("card-to-tile", "originRotation", change['rotation']);
  }
  await canvas.scene.updateEmbeddedDocuments("Wall", updates);
  await tile.setFlag("card-to-tile", "originX", tile.x);
  await tile.setFlag("card-to-tile", "originY", tile.y);
  await tile.setFlag("card-to-tile", "originRotation", change['rotation']);
});

Hooks.on("preDeleteTile", async (tile) => {
  const wallIds = tile.flags["card-to-tile"]?.wallIds;

  if (!Array.isArray(wallIds) || wallIds.length === 0) return;

  await canvas.scene.deleteEmbeddedDocuments("Wall", wallIds);
});

Hooks.on("renderCardConfig", (app, html) => {
  // หา root ของ CardConfig window
  const cardConfigEl = html.closest(".card-config");
  if (!cardConfigEl) return;

  // หา title ใน header
  const titleEl = cardConfigEl.querySelector(
    ".window-header .window-title"
  );
  if (!titleEl) return;

  // สร้างปุ่ม
  if( cardConfigEl.querySelector('.card-wall-preview')) return

  const btn = document.createElement("button");
  btn.type = "button";
  btn.classList.add("card-wall-preview");
  btn.innerHTML = `<i class="fas fa-draw-polygon wall-card"></i> Wall Preview`;

  btn.addEventListener("click", () => {
    console.log(app)
    openCardWallPreview(app.document);
  });

  // ใส่ปุ่มต่อจาก title
  titleEl.after(btn);
});

class CardWallPreview extends Application {
  constructor(card, config) {
    super();
    this.card = card;
    this.config = foundry.utils.deepClone(config);
    this.dragging = null;
    this.drawingWall = null;
    this.selectedWall = null;
    this.mode = "edit"; // edit | draw  
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      title: "Card Wall Editor",
      width: 420,
      height: 520,
      resizable: true,
    });
  }

 async _renderInner() {
 const container = document.createElement("div");
    container.style.position = "relative";
    container.style.width =this.config.tile?.width? `${this.config.tile?.width}px` : '420px';
    container.style.height = this.config.tile?.height? `${this.config.tile?.height}px`: '520px';
    container.style.minWidth = "420px";
    container.style.minHeight = "520px";
    console.log(this.config)
    const img = document.createElement("img");
    img.src = this.card.img;
    img.style.width = this.config.tile?.width? `${this.config.tile?.width}px` : '420px';
    img.style.height = this.config.tile?.height? `${this.config.tile?.height}px`: '520px';
    img.style.objectFit = 'cover';
    img.style.display = "relative";
    img.style.position = "absolute";
    img.style.zIndex = 1;

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    // svg.setAttribute("viewBox", `0 0 ${this.config.tile?.height ?? 300}px ${this.config.tile?.width ?? 420}px`);
    svg.style.width = img.style.width;
    svg.style.height = img.style.height;
    svg.style.display = "block";
    svg.style.position = "absolute";
    svg.style.zIndex = 5;
    this.svg = svg;
    this._drawWalls();
    svg.addEventListener("mousemove", this._onMove.bind(this));
    svg.addEventListener("mouseup", () => (this.dragging = null));
    svg.addEventListener("mouseleave", () => (this.dragging = null));
    svg.addEventListener("click", this._onClick.bind(this));
    svg.addEventListener("click", () => {
      if (this.mode === "edit") {
        this.selectedWall = null;
        this._drawWalls();
      }
    });
    this._keyHandler = this._onKeyDown.bind(this);
    window.addEventListener("keydown", this._keyHandler);
    const toolbar = document.createElement("div");
    toolbar.style.display = "flex";
    toolbar.style.gap = "0.5em";
    
    const drawBtn = document.createElement("button");
    drawBtn.innerText = "✏️ Draw";
    drawBtn.onclick = () => {
      this.mode = "draw";
    };

    const editBtn = document.createElement("button");
    editBtn.innerText = "🖱 Edit";
    editBtn.onclick = () => {
      this.mode = "edit";
    };


    const typeSelect = document.createElement("select");

    ["wall", "door", "secret", "window"].forEach(t => {
      const o = document.createElement("option");
      o.value = t;
      o.innerText = t;
      typeSelect.appendChild(o);
    });
    
    typeSelect.onchange = () => {
      if (!this.selectedWall) return;
      this.selectedWall.type = typeSelect.value;
      this._drawWalls();
    };
    toolbar.append(drawBtn, editBtn, typeSelect);
    container.prepend(toolbar);
    const saveBtn = document.createElement("button");
    saveBtn.innerText = "💾 Save to Card";
    saveBtn.onclick = () => this._exportToCard();

    container.appendChild(saveBtn);
    container.appendChild(img);
    container.appendChild(svg);
    return container;
  }

  close() {
    window.removeEventListener("keydown", this._keyHandler);
    return super.close();
  }

  _onKeyDown(e) {
    if (!this.selectedWall) return;
  
    if (e.key === "Delete" || e.key === "Backspace") {
      const index = this.config.walls.indexOf(this.selectedWall);
      if (index !== -1) {
        this.config.walls.splice(index, 1);
        this.selectedWall = null;
        this._drawWalls();
      }
    }
  }

  _drawWalls() {
    this.svg.innerHTML = "";
    console.log(this.config)
    for (const wall of this.config.walls) {
      const [x1, y1, x2, y2] = wall.points;

      this._drawLine(x1, y1, x2, y2, wall);
      this._drawPoint(x1, y1, wall, 0);
      this._drawPoint(x2, y2, wall, 2);
    }
  }

  _drawLine(x1, y1, x2, y2, wall) {
    const line = document.createElementNS(this.svg.namespaceURI, "line");
    const colors = {
      wall: "red",
      door: "lime",
      secret: "purple",
      window: "cyan"
    };
    line.setAttribute("x1", x1);
    line.setAttribute("y1", y1);
    line.setAttribute("x2", x2);
    line.setAttribute("y2", y2);
  
    line.setAttribute(
      "stroke",
      wall === this.selectedWall
        ? "yellow"
        : (colors[wall.type] ?? "red")
    );
    line.setAttribute("stroke-width", "5");
    line.style.cursor = "pointer";
  
    line.addEventListener("click", (e) => {
      e.stopPropagation();
  
      if (this.mode !== "edit") return;
  
      this.selectedWall = wall;
      this._drawWalls();
    });
  
    this.svg.appendChild(line);
  }

  _drawPoint(x, y, wall, index) {
    const c = document.createElementNS(this.svg.namespaceURI, "circle");
    c.setAttribute("cx", x);
    c.setAttribute("cy", y);
    c.setAttribute("r", 8);
    c.setAttribute("fill", "orange");
    c.style.cursor = "pointer";
    c.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      this.dragging = { wall, index };
    });

    this.svg.appendChild(c);
  }

  _onMove(e) {
    if (!this.dragging) return;

    const pt = this.svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const loc = pt.matrixTransform(this.svg.getScreenCTM().inverse());

    this.dragging.wall.points[this.dragging.index] = Math.round(loc.x);
    this.dragging.wall.points[this.dragging.index + 1] = Math.round(loc.y);

    this._drawWalls();
  }

  async _exportToCard() {
    const json = JSON.stringify(this.config, null, 2);

    const block =
`<pre><code>card-config
${json}
</code></pre>`;

    await this.card.update({ description: block });

    ui.notifications.info("Card wall config saved");
    this.close();
  }

  async _onClick(event) {
    const pt = this.svg.createSVGPoint();
    pt.x = event.clientX;
    pt.y = event.clientY;
  
    const loc = pt.matrixTransform(this.svg.getScreenCTM().inverse());
    const x = Math.round(loc.x);
    const y = Math.round(loc.y);
  
    // click แรก
    if (!this.drawingWall) {
      this.drawingWall = { x, y };
      return;
    }
  
    // click ที่สอง → create wall
    this.config.walls.push({
      points: [
        this.drawingWall.x,
        this.drawingWall.y,
        x,
        y
      ]
    });
  
    this.drawingWall = null;
    this._drawWalls();
  }
  
}

let cardWallPreviewApp = null;

function openCardWallPreview(card) {
  if (!card) return;

  // ปิดอันเก่า (ถ้ามี)
  if (cardWallPreviewApp) {
    cardWallPreviewApp.close();
  }

  const config = getCardConfigFromDescription(card)

  cardWallPreviewApp = new CardWallPreview(card, config);
  cardWallPreviewApp.render(true);
}