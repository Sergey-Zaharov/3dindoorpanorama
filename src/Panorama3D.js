import * as THREE from "three";
import {
    CylinderGeometry,
    MeshBasicMaterial,
    Vector2,
    Vector3
} from "three";
import { GLTFLoader } from "three-stdlib";
import { OrbitControls } from "three-stdlib/controls/OrbitControls";
import { GUI } from "lil-gui";

class Panorama3D {
    /**
     * 
     * @param {string} elementID ID of dom element 
     * @param {URL} baseURL base URL for environments 
     * @param {string} uniqueID default ID of initial environment 
     * @param {string} modelFilename default filename for model.glb file 
     * @param {string} positionsFilename default filename for positions.json file
     */
    constructor(elementID, baseURL, uniqueID, modelFilename, positionsFilename) {
        this.baseURL = baseURL;
        this.uniqueID = uniqueID;
        this.modelFilename = modelFilename? modelFilename : 'model.glb';
        this.positionsFilename = positionsFilename? positionsFilename : 'positions.json';
        this.render = this.render.bind(this);
        this.onDocumentMouseDown = this.onDocumentMouseDown.bind(this);
        this.onDocumentMouseMove = this.onDocumentMouseMove.bind(this);
        this.onDocumentMouseUp = this.onDocumentMouseUp.bind(this);
        this.drawTexture = this.drawTexture.bind(this);
        this.moveCamera = this.moveCamera.bind(this);
        this.el = document.getElementById(elementID);
        this.scene = null;
        this.renderer = null;
        this.camera = null;
        this.controls = null;
        this.models = [];

        this.isTransition = false;

        const immuneObjectMaterial = new THREE.MeshBasicMaterial({
            color: "#fff",
            stencilWrite: false, // Do not write to the stencil buffer
            stencilFunc: THREE.AlwaysStencilFunc // Always pass the stencil test
        });

        this.constants = Object.freeze({
            DEBUG_MODE: false,
            CAMERA_POD_HEIGHT: 4,
            CAMERA_OFFSET: new Vector3(0.1, 0, 0),

            MARKER_HEIGHT: 0.5,
            MARKER_COLOR_IDLE: new THREE.Color("#ffff00"),
            MARKER_COLOR_HOVERED: new THREE.Color("#00ff00"),

            ROOM_MATERIAL: new THREE.MeshStandardMaterial({
                color: "#aaaaaa"
            }),
            BACKGROUND_SPHERE_MATERIAL: immuneObjectMaterial.clone(),

        })

        this.constants.BACKGROUND_SPHERE_MATERIAL.side = THREE.BackSide;
        this.constants.BACKGROUND_SPHERE_MATERIAL.depthTest = false;

        this.constants.ROOM_MATERIAL.colorWrite = false; // Do not write to the color buffer
        this.constants.ROOM_MATERIAL.depthWrite = true; // Do write to the depth buffer
        this.constants.ROOM_MATERIAL.stencilWrite = true; // Write to the stencil buffer
        this.constants.ROOM_MATERIAL.stencilFunc = THREE.AlwaysStencilFunc; // Pass the stencil test always
        this.constants.ROOM_MATERIAL.stencilZPass = THREE.ReplaceStencilOp; // Replace the stencil value with the reference value on z-pass
        /**
         * @type {{index:number, position:THREE.Vector3, name:string, texture: THREE.Texture, marker: THREE.Mesh}[]}
         */
        this.spots = [];
        /**
         * @type {THREE.Mesh[]}
         */
        this.markers = [];

        this.raycaster = new THREE.Raycaster();
        this.mouse = new Vector2();
        this.mouseOnDown = new Vector2();
        this.isPanning = false;
        this.isMouseDown = false;

        this.moving = {
            t: 0,
            dt: 0.04,
            a: new THREE.Vector3(),
            b: new THREE.Vector3(),
            isMoving: false,
        }
    }

    run() {
        (async () => {
            this.positionsData = await new Promise((resolve, reject) => {
                fetch(`${this.baseURL}/${this.uniqueID}/${this.positionsFilename}`)
                    .then(res => resolve(res.json()))
                    .catch(e => reject(e));
            })
            if (this.positionsData.length) {
                await this.init();
                await this.render();
            }
        })();
    }

    async init() {
        this.renderer = new THREE.WebGLRenderer({ stencil: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.el.appendChild(this.renderer.domElement);

        this.scene = new THREE.Scene();

        this.camera = new THREE.PerspectiveCamera(
            75,
            window.innerWidth / window.innerHeight,
            0.1,
            1200
        );
        this.camera.position.add(this.constants.CAMERA_OFFSET);
        this.scene.add(this.camera);

        const light = new THREE.PointLight();
        light.position.set(0.5, 9, 1.3);
        this.scene.add(light);

        const ambient = new THREE.AmbientLight("#ffffff", 0.2);
        this.scene.add(ambient);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableZoom = false;

        const sphereG = new THREE.SphereGeometry(1000);
        const sphereMesh = new THREE.Mesh(sphereG, this.constants.BACKGROUND_SPHERE_MATERIAL);
        sphereMesh.scale.z = -1;
        this.scene.add(sphereMesh);

        this.clock = new THREE.Clock(true);

        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d');
        if (this.constants.DEBUG_MODE) {
            // this.renderer.domElement.parentElement.appendChild(this.ctx.canvas);
            // this.canvas.className = 'debug_canvas';
        }
        this.state = 0;
        this.targetState = 0;
        this.canvas.width = 1600;
        this.canvas.height = 800;
        this.texture = new THREE.CanvasTexture(this.canvas);
        this.texture.mapping = THREE.EquirectangularReflectionMapping;
        this.texture.encoding = THREE.sRGBEncoding;
        this.previousImg = null;
        this.nextImg = null;

        await this.initRoom();
        this.initPositions();
        this.initEventListeners(this.renderer);
        if (this.constants.DEBUG_MODE) {
            this.initDatGui();
        }
        await this.switchToSpot(0, true);

    }

    async initRoom() {
        const gltfLoader = new GLTFLoader();
        await new Promise((resolve => {
            gltfLoader.loadAsync(`${this.baseURL}/${this.uniqueID}/${this.modelFilename}`).then((model) => {
                model.scene.traverse((child) => {
                    if (!child.isMesh || !child.material) {
                        return;
                    }
                    child.material = this.constants.ROOM_MATERIAL;
                });
                this.scene.add(model.scene);
                this.models.push(model.scene);
                model.scene.updateMatrixWorld(true);
                resolve(true);
            });
        }))
    };

    initPositions() {
        const scene = this.scene;

        this.spots = this.positionsData.map((pointData, spotIndex) => {
            const position = new THREE.Vector3(
                pointData.position[0],
                pointData.position[2],
                pointData.position[1],
            );

            const marker = new THREE.Mesh(
                new CylinderGeometry(1, 1, this.constants.MARKER_HEIGHT),
                new MeshBasicMaterial({ color: this.constants.MARKER_COLOR_IDLE })
            );
            const end = new THREE.Vector3().copy(position);
            end.y -= 50;
            const floorPoint = this.findIntersectionPoint(this.models, position, end);
            if (floorPoint) {
                position.copy(floorPoint);
                position.y += this.constants.MARKER_HEIGHT / 2;
            }
            marker.position.copy(position);
            marker.userData.spotIndex = spotIndex;

            scene.add(marker);
            this.markers.push(marker);

            return {
                index: spotIndex,
                position,
                marker
            };
        });
    };

    initEventListeners(renderer) {
        // add event listener for mouse click
        renderer.domElement.addEventListener("mousedown", this.onDocumentMouseDown, false);
        renderer.domElement.addEventListener("mouseup", this.onDocumentMouseUp, false);
        renderer.domElement.addEventListener("mousemove", this.onDocumentMouseMove, false);
    };

    initDatGui() {
        const guiOptions = {
            RoomVisible: false
        };

        const gui = new GUI();
        const folder = gui.addFolder("Options");

        folder
            .add(guiOptions, "RoomVisible")
            .name("Room Visible")
            .onChange((value) => {
                this.constants.ROOM_MATERIAL.colorWrite = value;
                this.constants.BACKGROUND_SPHERE_MATERIAL.depthTest = value;
                // ROOM_MATERIAL.wireframe = value;
            });
    };

    onDocumentMouseDown(event) {
        this.mouseOnDown.set(event.clientX, event.clientY);
        this.isMouseDown = true;
        this.isPanning = false;
    };

    onDocumentMouseUp(event) {
        this.isMouseDown = false;
        this.mouse.x = event.clientX;
        this.mouse.y = event.clientY;
        if (this.isPanning) {
            console.log('mouse dragged, ignore "click"');
            return;
        }

        // calculate normalized mouse coordinates within canvas
        this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

        // create raycaster from camera and mouse coordinates
        this.raycaster.setFromCamera(this.mouse, this.camera);

        // calculate objects intersecting the picking ray
        const intersects = this.raycaster.intersectObjects(this.markers);
        if (intersects[0]) {
            const marker = intersects[0].object;
            this.switchToSpot(marker.userData.spotIndex);
            marker.material.color = this.constants.MARKER_COLOR_IDLE;
        }
    };

    onDocumentMouseMove(event) {
        this.mouse.x = event.clientX;
        this.mouse.y = event.clientY;
        this.isPanning = this.isMouseDown && this.mouse.distanceTo(this.mouseOnDown) > 5;

        let hoveredMarker = null;
        if (!this.isPanning) {
            // calculate normalized mouse coordinates within canvas
            this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
            this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

            // create raycaster from camera and mouse coordinates
            this.raycaster.setFromCamera(this.mouse, this.camera);

            // calculate objects intersecting the picking ray
            const intersects = this.raycaster.intersectObjects(this.markers);
            if (intersects.length > 0) {
                hoveredMarker = intersects[0].object;
            }
        }

        this.markers.forEach(
            (marker) =>
            (marker.material.color =
                marker === hoveredMarker ? this.constants.MARKER_COLOR_HOVERED : this.constants.MARKER_COLOR_IDLE)
        );
    };
    async render() {
        // Clear the stencil buffer and set the reference value
        this.renderer.state.buffers.stencil.setTest(true);
        this.renderer.state.buffers.stencil.setFunc(THREE.EqualStencilFunc, 1, 0xff);
        this.renderer.state.buffers.stencil.setOp(
            THREE.KeepStencilOp,
            THREE.KeepStencilOp,
            THREE.KeepStencilOp
        );
        this.renderer.state.buffers.stencil.setClear(0);
        await this.drawTexture();
        this.moveCamera();
        this.renderer.render(this.scene, this.camera);
        this.state = this.targetState >= this.state ? this.state + .04 : this.state - .04;
        this.state = this.state < 0 ? 0 : this.state > 1 ? 1 : this.state;

        requestAnimationFrame(this.render);

    };

    async switchToSpot(spotNumber, instantMove = false) {
        this.previousImg = this.nextImg;
        this.nextImg = `${this.baseURL}/${this.uniqueID}/${this.positionsData[spotNumber].name}`; 
        const spot = this.spots[spotNumber];
        await this.drawTexture();
        this.constants.BACKGROUND_SPHERE_MATERIAL.map = this.texture;
        this.constants.BACKGROUND_SPHERE_MATERIAL.map.needsUpdate = true;
        this.constants.CAMERA_OFFSET.copy(this.camera.position).sub(this.controls.target);

        this.controls.target.copy(spot.position).y += this.constants.CAMERA_POD_HEIGHT;
        this.state = 0;
        this.targetState = 1;
        this.moving.a.copy(instantMove? new THREE.Vector3().copy(this.controls.target).add(this.constants.CAMERA_OFFSET) : this.camera.position);
        this.moving.b.copy(this.controls.target).add(this.constants.CAMERA_OFFSET);
        this.moving.isMoving = true;
        this.isTransition = true;
    };

    async drawTexture() {
        if (!this.isTransition) return false;
        const ctx = this.ctx;
        const state = this.state;
        ctx.globalAlpha = 1;

        if (this.previousImg !== null) {

            await new Promise(resolve => {
                const image = new Image(1600, 800);
                image.onload = function () {
                    ctx.drawImage(this, 0, 0, 1600, 800);
                    ctx.globalAlpha = state;
                    resolve(true);
                }
                image.src = this.previousImg;
            })
        }

        await new Promise(resolve => {
            const image = new Image(1600, 800);
            image.onload = function () {
                ctx.drawImage(this, 0, 0, 1600, 800);
                resolve(true);
            }
            image.src = this.nextImg;
        })
        if (this.constants.BACKGROUND_SPHERE_MATERIAL.map) {
            this.constants.BACKGROUND_SPHERE_MATERIAL.map.needsUpdate = true;
        }
        if (this.state >= 1) {
            this.isTransition = false;
        }
    };

    lerp(a, b, t) {
        return a + (b - a) * t;
    };

    moveCamera() {
        if (!this.moving.isMoving) return;

        this.moving.t += this.moving.dt;

        const newPosition = new THREE.Vector3();
        newPosition.y = this.moving.a.y;

        if (this.moving.t >= 1) {
            newPosition.copy(this.moving.b);
            this.moving.t = 0;
            this.moving.isMoving = false;
        } else {
            newPosition.x = this.lerp(this.moving.a.x, this.moving.b.x, this.moving.t);
            newPosition.z = this.lerp(this.moving.a.z, this.moving.b.z, this.moving.t);
        }

        this.camera.position.copy(newPosition);

    };
    /**
     * @param {THREE.Vector3} start
     * @param {THREE.Vector3} end
     */
    drawDebugLine(start, end) {
        const material = new THREE.LineBasicMaterial({color: 0xff0000});
        const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
        const line = new THREE.Line(geometry, material);
        this.scene.add(line);
    }

    /**
     * 
     * @param {THREE.Vector3} point 
     */
    drawDebugSphere(point) {
        const material = new THREE.MeshBasicMaterial({color: 0xff00ff});
        material.wireframe = true;
        const geometry = new THREE.SphereGeometry(0.25, 15, 15);
        const sphere = new THREE.Mesh(geometry, material);
        sphere.position.copy(point);
        this.scene.add(sphere);
    }

    /**
     * 
     * @param {THREE.Object3D[]} objects 
     * @param {THREE.Vector3} start 
     * @param {THREE.Vector3} end 
     * @param {boolean} debug 
     * @returns 
     */
    findIntersectionPoint(objects, start, end, debug = false) {
        if (!objects.length) return null;
        let point = null;
        const direction = new THREE.Vector3().copy(end).sub(start).normalize();
        const raycaster = new THREE.Raycaster();
        raycaster.set(start, direction);
        raycaster.far = 50;
        const intersectObjects =  raycaster.intersectObjects(objects[0].children, true);
        if (intersectObjects.length) {
            point = new THREE.Vector3().copy(intersectObjects[0].point);
        }
        // visualize raycast
        if (this.constants.DEBUG_MODE && debug && point) {
            this.drawDebugLine(start, end);
            this.drawDebugSphere(point);
        }

        return point;
    }
}

export default Panorama3D;
