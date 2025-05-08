import React, { useState, useCallback, useEffect, useRef } from 'react';
import ReactFlow, {
    MiniMap,
    Controls,
    Background,
    useNodesState,
    useEdgesState,
    addEdge,
    useReactFlow,
    ReactFlowProvider,
    MarkerType, // Import MarkerType for edge arrows
} from 'reactflow';
import 'reactflow/dist/style.css';
import axios from 'axios'; // For API calls
import NodeConfigPanel from './NodeConfigPanel'; // Import the config panel
import LogDisplay from './LogDisplay'; // Import the new LogDisplay

// MUI Imports
import Box from '@mui/material/Box';
import Drawer from '@mui/material/Drawer';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import List from '@mui/material/List';
import Typography from '@mui/material/Typography';
import Divider from '@mui/material/Divider';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';

// MUI Icons
import InputIcon from '@mui/icons-material/Input';
import NotesIcon from '@mui/icons-material/Notes'; // Default/Log
import SmartToyIcon from '@mui/icons-material/SmartToy'; // LLM
import CodeIcon from '@mui/icons-material/Code';
import SendIcon from '@mui/icons-material/Send'; // Webhook Action
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import SaveIcon from '@mui/icons-material/Save';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import AccountTreeIcon from '@mui/icons-material/AccountTree'; // Icon for App Title

// Custom Node Components
import DefaultNode from './nodes/DefaultNode';
import InputNode from './nodes/InputNode';
import LlmNode from './nodes/LlmNode';
import CodeNode from './nodes/CodeNode';
import WebhookNode from './nodes/WebhookNode';

const drawerWidth = 240;
const logPanelHeight = 200;

// Helper function to get icon based on node type (for palette)
const getNodeIcon = (nodeType) => {
    switch (nodeType) {
        case 'trigger': return <InputIcon />;
        case 'defaultnode': return <NotesIcon />;
        case 'llm': return <SmartToyIcon />;
        case 'code': return <CodeIcon />;
        case 'webhook_action': return <SendIcon />;
        default: return <NotesIcon />;
    }
};

// Available node types for the palette
const nodeTypesList = [
    { type: 'trigger', label: 'Input / Trigger' },
    { type: 'defaultnode', label: 'Default / Log' },
    { type: 'llm', label: 'LLM Call' },
    { type: 'code', label: 'Code Execution' },
    { type: 'webhook_action', label: 'Webhook Action' },
];

// Mapping for React Flow
const nodeTypes = {
    defaultnode: DefaultNode,
    trigger: InputNode,
    llm: LlmNode,
    code: CodeNode,
    webhook_action: WebhookNode,
};

let id_counter = 0; // Use a different name to avoid potential conflicts
const getId = () => `dndnode_${id_counter++}`;

// Default edge options
const defaultEdgeOptions = {
    animated: true,
    type: 'smoothstep',
    markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 20,
        height: 20,
        color: '#757575', // Use theme color later if needed
    },
    style: {
        strokeWidth: 1.5,
        stroke: '#757575', // Use theme color later if needed
    },
};

// Default viewport settings - more zoomed out
const defaultViewport = {
    x: 0,
    y: 0,
    zoom: 0.75, // Lower zoom value for a more zoomed out view
};

function WorkflowEditor() {
    const reactFlowWrapper = useRef(null); // Ref for drag and drop bounds
    const { screenToFlowPosition, project } = useReactFlow(); // project needed for viewport
    const [nodes, setNodes, onNodesChange] = useNodesState([]); // Start empty
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);
    const [workflowName, setWorkflowName] = useState('My Workflow');
    const [workflowId, setWorkflowId] = useState(null); // Or generate UUID
    const [runLogs, setRunLogs] = useState([]);
    const [selectedNode, setSelectedNode] = useState(null); // State for selected node
    const [configNode, setConfigNode] = useState(null); // State for node with config modal open
    const [nodeExecutionStatus, setNodeExecutionStatus] = useState({}); // { nodeId: status }
    const eventSourceRef = useRef(null); // Ref to store the EventSource instance
    const [loadWorkflowIdInput, setLoadWorkflowIdInput] = useState(''); // State for load input

    // Update node data callback for the config panel
    const updateNodeData = useCallback((nodeId, newData) => {
        setNodes((nds) =>
            nds.map((node) => {
                if (node.id === nodeId) {
                    // Ensure data exists before merging
                    const currentData = node.data || {};
                    return { ...node, data: { ...currentData, ...newData } };
                }
                return node;
            })
        );
    }, [setNodes]);

    const onConnect = useCallback(
        (params) => setEdges((eds) => addEdge(params, eds)), // defaultEdgeOptions applied globally
        [setEdges],
    );

    // --- Node Selection Handler ---
    const onNodeClick = useCallback((event, node) => {
        console.log("Node clicked:", node);
        // Just select the node but don't open the config panel
        setSelectedNode(node);
    }, []);

    // --- Node Double-Click Handler for Opening Config ---
    const onNodeDoubleClick = useCallback((event, node) => {
        console.log("Node double-clicked:", node);
        // Make sure the node is also selected
        setSelectedNode(node);
        // Open config panel on double-click
        setConfigNode(node);
    }, []);

    // --- Pane Click Handler (to deselect node) ---
    const onPaneClick = useCallback(() => {
        setSelectedNode(null);
        // Don't close config modal when clicking on pane
    }, []);

    // Close modal with escape key
    useEffect(() => {
        const handleKeyDown = (event) => {
            if (event.key === 'Escape' && configNode) {
                setConfigNode(null);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [configNode]);

    // --- Drag and Drop for Adding Nodes ---
    const onDragOver = useCallback((event) => {
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'move';
    }, []);

    const onDrop = useCallback(
        (event) => {
            event.preventDefault();
            event.stopPropagation();

            const type = event.dataTransfer.getData('application/reactflow');
            if (typeof type === 'undefined' || !type) return;

            const position = screenToFlowPosition({
                x: event.clientX - drawerWidth, // Adjust for drawer width
                y: event.clientY - 64, // Adjust for AppBar height (approx)
            });

            // Find label for the type
            const nodeInfo = nodeTypesList.find(n => n.type === type);
            const nodeLabel = nodeInfo ? nodeInfo.label : `${type} Node`;

            const newNode = {
                id: getId(),
                type,
                position,
                data: { label: nodeLabel }, // Initialize with label
            };
            setNodes((nds) => nds.concat(newNode));
        },
        [screenToFlowPosition, setNodes]
    );

    // --- Node Type Drag Start ---
    const onDragStart = (event, nodeType) => {
        console.log("Dragging node type:", nodeType);
        event.dataTransfer.setData('application/reactflow', nodeType);
        event.dataTransfer.effectAllowed = 'move';

        // Create a small drag preview
        const dragPreview = document.createElement('div');
        dragPreview.style.width = '100px';
        dragPreview.style.height = '40px';
        dragPreview.style.backgroundColor = '#f0f0f0';
        dragPreview.style.border = '1px solid #ccc';
        dragPreview.style.borderRadius = '4px';
        dragPreview.style.padding = '8px';
        dragPreview.style.display = 'flex';
        dragPreview.style.alignItems = 'center';
        dragPreview.style.justifyContent = 'center';
        dragPreview.style.fontSize = '12px';
        dragPreview.style.opacity = '0.8';
        dragPreview.textContent = nodeTypesList.find(n => n.type === nodeType)?.label || nodeType;

        // Append preview to DOM temporarily
        document.body.appendChild(dragPreview);

        // Set as drag image at mouse position
        event.dataTransfer.setDragImage(dragPreview, 50, 20);

        // Remove preview after a short delay
        setTimeout(() => {
            document.body.removeChild(dragPreview);
        }, 0);
    };

    // --- API Interaction --- 
    const baseUrl = window.location.origin;

    const handleSaveWorkflow = async () => {
        const currentWorkflowId = workflowId || `wf_${Date.now()}`;
        if (!workflowId) {
            setWorkflowId(currentWorkflowId);
        }

        const workflowData = {
            id: currentWorkflowId,
            name: workflowName,
            nodes: nodes.map(n => ({ // Map to backend format
                id: n.id,
                type: n.type || 'default', // Ensure type is present
                position: n.position,
                data: n.data || { label: n.type }, // Add default data if missing
            })),
            edges: edges.map(e => ({
                id: e.id,
                source: e.source,
                target: e.target,
                sourceHandle: e.sourceHandle,
                targetHandle: e.targetHandle
            })),
            metadata: { /* Add viewport, etc. if needed */ }
        };

        try {
            console.log("Saving workflow:", workflowData);
            // Use explicitly constructed URL
            const response = await axios.post(`${baseUrl}/api/workflows`, workflowData);
            alert(`Workflow saved successfully! ID: ${response.data.workflow_id}`);
            setWorkflowId(response.data.workflow_id); // Ensure ID is set after save
        } catch (error) {
            console.error("Error saving workflow:", error);
            alert(`Error saving workflow: ${error.response?.data?.detail || error.message}`);
        }
    };

    const handleLoadWorkflow = async () => {
        const idToLoad = loadWorkflowIdInput.trim();
        if (!idToLoad) {
            alert("Please enter a Workflow ID to load.");
            return;
        }
        try {
            console.log(`Loading workflow: ${idToLoad}`);
            // Use explicitly constructed URL
            const response = await axios.get(`${baseUrl}/api/workflows/${idToLoad}`);
            const wf = response.data;
            console.log("Loaded workflow data:", wf);

            // Map nodes and edges back to React Flow format if needed
            // Assuming backend format matches closely for now
            const flowNodes = wf.nodes.map(n => ({
                id: n.id,
                type: n.type,
                position: n.position,
                data: n.data || { label: n.type }, // Ensure data is present
            }));
            const flowEdges = wf.edges.map(e => ({
                id: e.id,
                source: e.source,
                target: e.target,
                sourceHandle: e.sourceHandle,
                targetHandle: e.targetHandle
            }));

            setNodes(flowNodes);
            setEdges(flowEdges);
            setWorkflowName(wf.name || 'Loaded Workflow');
            setWorkflowId(wf.id);
            setRunLogs([]); // Clear logs when loading new workflow
            setSelectedNode(null); // Close config panel
            setNodeExecutionStatus({}); // Clear statuses
            alert('Workflow loaded!');
        } catch (error) {
            console.error("Error loading workflow:", error);
            alert(`Error loading workflow: ${error.response?.data?.detail || error.message}`);
        }
    };

    const handleRunWorkflow = async () => {
        if (!workflowId) {
            alert("Please save or load a workflow before running.");
            return;
        }

        if (eventSourceRef.current) {
            console.log("Closing previous SSE connection.");
            eventSourceRef.current.close();
            eventSourceRef.current = null;
        }

        // Clear previous logs and statuses
        setRunLogs([]); // Clear logs immediately
        setNodeExecutionStatus({}); // Clear node statuses
        // Add initial entry
        setRunLogs([{ step: "Initiating Run...", status: "Pending", timestamp: Date.now() / 1000 }]);

        try {
            const response = await axios.post(`${baseUrl}/api/workflows/${workflowId}/run`, {});
            const runId = response.data.run_id;

            if (!runId) throw new Error("Backend did not return a run_id.");

            console.log(`Obtained run_id: ${runId}. Connecting to SSE stream...`);
            // Clear initiating message before streaming starts
            setRunLogs([]);

            const sseUrl = `${baseUrl}/api/workflows/${workflowId}/runs/${runId}/stream`;
            const newEventSource = new EventSource(sseUrl);
            eventSourceRef.current = newEventSource;

            newEventSource.onopen = () => { /* ... */ };

            newEventSource.onmessage = (event) => {
                try {
                    const logEntry = JSON.parse(event.data);
                    if (logEntry.step === "__END__") {
                        // ... handle end ...
                        newEventSource.close();
                        eventSourceRef.current = null;
                        // Optionally reset node statuses after a short delay?
                        // setTimeout(() => setNodeExecutionStatus({}), 2000);
                        return;
                    }

                    // Update logs
                    setRunLogs(prev => [...prev, logEntry]);

                    // Update node status based on log entry
                    if (logEntry.node_id) {
                        setNodeExecutionStatus(prevStatus => ({
                            ...prevStatus,
                            [logEntry.node_id]: logEntry.status || 'Unknown' // Update status for this node
                        }));
                    }
                    // Clear status if it's the overall 'End' step
                    if (logEntry.step === 'End') {
                        // Delay clearing slightly to see final statuses
                        setTimeout(() => setNodeExecutionStatus({}), 1500);
                    }

                } catch (parseError) {
                    console.error("Error parsing SSE message data:", parseError, "Data:", event.data);
                    setRunLogs(prev => [...prev, { step: "Log Stream Error", status: "Failed", error: `Malformed message received`, timestamp: Date.now() / 1000 }]);
                }
            };

            newEventSource.onerror = (error) => {
                console.error("SSE connection error:", error);
                setRunLogs(prev => {
                    if (prev.length > 0 && prev[prev.length - 1].status === "SSE Error") return prev;
                    return [...prev, { step: "Log Stream Error", status: "SSE Error", error: "Connection failed or closed unexpectedly.", timestamp: Date.now() / 1000 }];
                });
                if (newEventSource) newEventSource.close();
                eventSourceRef.current = null;
                setNodeExecutionStatus({});
            };

        } catch (error) {
            console.error("Error initiating workflow run:", error);
            const errorMsg = error.response?.data?.detail || error.message;
            alert(`Error starting workflow run: ${errorMsg}`);
            setRunLogs([{
                "step": "Run Initiation Error",
                "status": "Failed",
                "error": errorMsg,
                "timestamp": Date.now() / 1000
            }]);
            setNodeExecutionStatus({});
        }
    };

    // Cleanup SSE connection on component unmount
    useEffect(() => {
        return () => {
            if (eventSourceRef.current) {
                console.log("Closing SSE connection on component unmount.");
                eventSourceRef.current.close();
            }
        };
    }, []);

    // Close config panel if the selected node is deleted
    useEffect(() => {
        if (configNode && !nodes.find(n => n.id === configNode.id)) {
            setConfigNode(null);
        }
    }, [nodes, configNode]);

    // *** NEW: Update nodes data when execution status changes ***
    useEffect(() => {
        setNodes((nds) =>
            nds.map((node) => {
                const status = nodeExecutionStatus[node.id] || null; // Get status or null
                // Avoid unnecessary updates if status hasn't changed
                if (node.data?.status === status) {
                    return node;
                }
                return {
                    ...node,
                    data: {
                        ...node.data,
                        status: status, // Add/update status in node data
                    },
                };
            })
        );
    }, [nodeExecutionStatus, setNodes]); // Rerun when status map changes

    return (
        <Box sx={{ display: 'flex', height: '100vh' }}>
            {/* Left Node Palette Drawer */}
            <Drawer
                variant="permanent"
                sx={{
                    width: drawerWidth,
                    flexShrink: 0,
                    [`& .MuiDrawer-paper`]: { width: drawerWidth, boxSizing: 'border-box' },
                }}
            >
                <Toolbar /> { /* Spacer to push content below AppBar */}
                <Box sx={{ overflow: 'auto', padding: '8px' }}>
                    <Typography variant="h6" sx={{ padding: '8px 16px' }}>Nodes</Typography>
                    <Divider />
                    <List>
                        {nodeTypesList.map((nodeInfo) => (
                            <ListItem key={nodeInfo.type} disablePadding>
                                <ListItemButton
                                    onDragStart={(event) => onDragStart(event, nodeInfo.type)}
                                    draggable
                                    sx={{ border: '1px dashed #ccc', marginBottom: '8px', borderRadius: '4px' }}
                                >
                                    <ListItemIcon sx={{ minWidth: '40px' }}>
                                        {getNodeIcon(nodeInfo.type)}
                                    </ListItemIcon>
                                    <ListItemText primary={nodeInfo.label} />
                                </ListItemButton>
                            </ListItem>
                        ))}
                    </List>
                </Box>
            </Drawer>

            {/* Main Content Area */}
            <Box
                component="main"
                sx={{
                    flexGrow: 1,
                    height: '100vh',
                    display: 'flex',
                    flexDirection: 'column',
                }}
            >
                {/* Top AppBar */}
                <AppBar position="fixed" sx={{ zIndex: (theme) => theme.zIndex.drawer + 1 }}>
                    <Toolbar>
                        <AccountTreeIcon sx={{ mr: 2 }} />
                        <Typography variant="h6" noWrap component="div" sx={{ flexGrow: 1 }}>
                            Mini Workflow Engine
                        </Typography>
                        <TextField
                            label="Workflow Name"
                            variant="outlined"
                            size="small"
                            value={workflowName}
                            onChange={(e) => setWorkflowName(e.target.value)}
                            sx={{ mr: 2, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 1, input: { color: 'white' }, label: { color: '#eee' } }}
                        />
                        <Button
                            variant="contained"
                            color="secondary"
                            startIcon={<SaveIcon />}
                            onClick={handleSaveWorkflow}
                            sx={{ mr: 2 }}
                        >
                            Save
                        </Button>
                        <TextField
                            label="Workflow ID to load"
                            variant="outlined"
                            size="small"
                            value={loadWorkflowIdInput}
                            onChange={(e) => setLoadWorkflowIdInput(e.target.value)}
                            sx={{ mr: 1, width: '200px', backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 1, input: { color: 'white' }, label: { color: '#eee' } }}
                        />
                        <Button
                            variant="contained"
                            startIcon={<FolderOpenIcon />}
                            onClick={handleLoadWorkflow}
                            sx={{ mr: 2 }}
                        >
                            Load
                        </Button>
                        <Button
                            variant="contained"
                            color="success"
                            startIcon={<PlayArrowIcon />}
                            onClick={handleRunWorkflow}
                            disabled={!workflowId}
                        >
                            Run Workflow
                        </Button>
                    </Toolbar>
                </AppBar>

                {/* React Flow Editor Area */}
                <Box
                    ref={reactFlowWrapper}
                    sx={{
                        flexGrow: 1,
                        marginTop: '64px', // Height of AppBar
                        height: `calc(100vh - 64px - ${logPanelHeight}px)`, // Full height minus AppBar and LogPanel
                        width: '100%',
                        overflow: 'hidden'
                    }}
                >
                    <ReactFlow
                        nodes={nodes}
                        edges={edges}
                        onNodesChange={onNodesChange}
                        onEdgesChange={onEdgesChange}
                        onConnect={onConnect}
                        onDragOver={onDragOver}
                        onDrop={onDrop}
                        nodeTypes={nodeTypes}
                        defaultEdgeOptions={defaultEdgeOptions}
                        defaultViewport={defaultViewport}
                        fitView
                        onNodeClick={onNodeClick}
                        onNodeDoubleClick={onNodeDoubleClick}
                        onPaneClick={onPaneClick}
                        proOptions={{ hideAttribution: true }}
                        selectNodesOnDrag={false}
                        nodeDragThreshold={1}
                        nodesFocusable={true}
                        elementsSelectable={true}
                    >
                        <Controls />
                        <MiniMap
                            style={{ height: 120 }}
                            zoomable
                            pannable
                        />
                        <Background color="#aaa" gap={16} />
                    </ReactFlow>
                </Box>

                {/* Log Panel at Bottom */}
                <Paper
                    elevation={3}
                    square
                    sx={{
                        height: `${logPanelHeight}px`,
                        width: '100%',
                        overflow: 'hidden',
                        boxSizing: 'border-box',
                        flexShrink: 0,
                    }}
                >
                    <LogDisplay logs={runLogs} />
                </Paper>
            </Box>

            {/* Node Config Modal - replacing the side panel */}
            {configNode && (
                <NodeConfigPanel
                    node={configNode}
                    onUpdate={updateNodeData}
                    onClose={() => setConfigNode(null)}
                    open={Boolean(configNode)}
                />
            )}
        </Box>
    );
}

// Wrap with ReactFlowProvider to use hooks like useReactFlow
function WorkflowEditorWrapper() {
    return (
        <ReactFlowProvider>
            <WorkflowEditor />
        </ReactFlowProvider>
    );
}

export default WorkflowEditorWrapper; 