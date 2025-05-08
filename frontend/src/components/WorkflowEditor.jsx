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
    getBezierPath, // Import for custom edge
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
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';

// MUI Icons
import InputIcon from '@mui/icons-material/Input';
import NotesIcon from '@mui/icons-material/Notes'; // Default/Log
import SmartToyIcon from '@mui/icons-material/SmartToy'; // LLM
import CodeIcon from '@mui/icons-material/Code';
import SendIcon from '@mui/icons-material/Send'; // Webhook Action
import WebhookIcon from '@mui/icons-material/Webhook'; // Webhook Trigger
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import SaveIcon from '@mui/icons-material/Save';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import AccountTreeIcon from '@mui/icons-material/AccountTree'; // Icon for App Title
import SettingsIcon from '@mui/icons-material/Settings';
import RefreshIcon from '@mui/icons-material/Refresh';

// Custom Node Components
import DefaultNode from './nodes/DefaultNode';
import InputNode from './nodes/InputNode';
import LlmNode from './nodes/LlmNode';
import CodeNode from './nodes/CodeNode';
import WebhookNode from './nodes/WebhookNode';
import WebhookInputNode from './nodes/WebhookInputNode';
import ModelConfigNode from './nodes/ModelConfigNode';

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
        case 'webhook_trigger': return <WebhookIcon />;
        case 'model_config': return <SettingsIcon />;
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
    { type: 'webhook_trigger', label: 'Webhook Trigger' },
    { type: 'model_config', label: 'Model Configuration' },
];

// Mapping for React Flow
const nodeTypes = {
    defaultnode: DefaultNode,
    trigger: InputNode,
    llm: LlmNode,
    code: CodeNode,
    webhook_action: WebhookNode,
    webhook_trigger: WebhookInputNode,
    model_config: ModelConfigNode,
};

// Change the id_counter to ensure it's not reset when the component re-renders
// Move it outside the component to make it truly stateful
let id_counter = 0; // Use a different name to avoid potential conflicts
const getId = () => {
    return `dndnode_${id_counter++}`;
};

// Helper function to update the ID counter based on existing nodes
const updateIdCounterFromNodes = (nodesList) => {
    if (!nodesList || nodesList.length === 0) return;

    // Find all node IDs that follow our pattern
    const dndNodeIds = nodesList
        .map(node => node.id)
        .filter(id => id.startsWith('dndnode_'));

    // Extract the numeric parts and find the maximum
    if (dndNodeIds.length > 0) {
        const numericParts = dndNodeIds.map(id => {
            const numPart = id.replace('dndnode_', '');
            return parseInt(numPart, 10);
        }).filter(num => !isNaN(num));

        if (numericParts.length > 0) {
            const maxId = Math.max(...numericParts);
            // Set the counter to one more than the maximum ID
            id_counter = maxId + 1;
            console.log(`Updated node ID counter to ${id_counter} based on existing nodes`);
        }
    }
};

// Custom edge component for model configuration connections
const ModelConfigEdge = ({ id, source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style = {} }) => {
    const [edgePath] = getBezierPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
    });

    return (
        <>
            <path
                id={id}
                style={{
                    ...style,
                    stroke: '#3f83f8',
                    strokeWidth: 2,
                    strokeDasharray: '5,5',
                }}
                className="react-flow__edge-path"
                d={edgePath}
            />
            <text>
                <textPath
                    href={`#${id}`}
                    style={{ fontSize: '10px', fill: '#3f83f8' }}
                    startOffset="50%"
                    textAnchor="middle"
                >
                    uses config
                </textPath>
            </text>
        </>
    );
};

// Add the edge type to React Flow
const edgeTypes = {
    modelConfig: ModelConfigEdge,
};

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

// Helper function to get the default label for a node type
const getDefaultLabelForNodeType = (nodeType) => {
    const nodeInfo = nodeTypesList.find(n => n.type === nodeType);
    return nodeInfo ? nodeInfo.label : `${nodeType} Node`;
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
    const [availableWorkflows, setAvailableWorkflows] = useState([]); // State for available workflows
    const [selectedWorkflowId, setSelectedWorkflowId] = useState(''); // State for selected workflow from dropdown

    // Function to validate the workflow nodes
    const validateWorkflow = useCallback(() => {
        // Create a map of validation errors by node ID
        const validationErrors = {};

        // Check LLM nodes for model configuration
        const modelConfigNodes = nodes.filter(n => n.type === 'model_config');

        nodes.forEach(node => {
            if (node.type === 'llm') {
                const hasOwnModel = node.data?.model;
                const hasModelConfigRef = node.data?.model_config_id && modelConfigNodes.some(n => n.id === node.data.model_config_id);

                if (!hasOwnModel && !hasModelConfigRef) {
                    validationErrors[node.id] = "LLM node needs a model configuration";
                }
            }
        });

        return validationErrors;
    }, [nodes]);

    // Effect to update node validation when nodes change
    useEffect(() => {
        const errors = validateWorkflow();

        // Update nodes with validation errors
        setNodes((nds) =>
            nds.map((node) => {
                const error = errors[node.id];
                // Avoid unnecessary updates if validation hasn't changed
                if (node.data?.validationError === error) {
                    return node;
                }
                return {
                    ...node,
                    data: {
                        ...node.data,
                        validationError: error, // Add/update validation error in node data
                    },
                };
            })
        );
    }, [nodes, validateWorkflow, setNodes]);

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
        (params) => {
            // Get the source and target nodes
            const sourceNode = nodes.find(node => node.id === params.source);
            const targetNode = nodes.find(node => node.id === params.target);

            // Check if this is a connection between a model_config and an LLM node
            if (sourceNode && targetNode) {
                if (sourceNode.type === 'model_config' && targetNode.type === 'llm') {
                    // Update the LLM node to use this model configuration
                    updateNodeData(targetNode.id, { model_config_id: sourceNode.id });

                    // Create a custom edge with different styling
                    return setEdges((eds) => addEdge({
                        ...params,
                        type: 'modelConfig', // Custom edge type
                        animated: true,
                    }, eds));
                }
                else if (sourceNode.type === 'llm' && targetNode.type === 'model_config') {
                    // Update the LLM node to use this model configuration
                    updateNodeData(sourceNode.id, { model_config_id: targetNode.id });

                    // Create a custom edge with different styling
                    return setEdges((eds) => addEdge({
                        ...params,
                        type: 'modelConfig', // Custom edge type
                        animated: true,
                    }, eds));
                }
            }

            // Default edge creation for other connections
            return setEdges((eds) => addEdge(params, eds));
        },
        [setEdges, nodes, updateNodeData]
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
        async (event) => {
            event.preventDefault();

            const reactFlowBounds = reactFlowWrapper.current.getBoundingClientRect();
            const nodeType = event.dataTransfer.getData('application/reactflow');

            // Return early if no node type or reactFlowBounds doesn't exist
            if (!nodeType || !reactFlowBounds) return;

            const position = screenToFlowPosition({
                x: event.clientX - reactFlowBounds.left,
                y: event.clientY - reactFlowBounds.top,
            });

            const newNode = {
                id: getId(),
                type: nodeType,
                position,
                data: { label: getDefaultLabelForNodeType(nodeType) },
            };

            // If this is a webhook_trigger node, we need to register it to get a webhook ID
            if (nodeType === 'webhook_trigger') {
                if (!workflowId) {
                    alert("Please save your workflow first before adding a webhook trigger node.");
                    return;
                }

                try {
                    // Add the node first so it appears immediately
                    setNodes((nds) => {
                        // Create a proper copy to avoid reference issues
                        const newNodes = [...nds];
                        newNodes.push(newNode);
                        return newNodes;
                    });

                    // Then register the webhook
                    const response = await axios.post('/api/webhooks/register', {
                        workflow_id: workflowId,
                        node_id: newNode.id
                    });

                    const webhook_id = response.data.webhook_id;

                    // Update the node with the webhook ID
                    setNodes((nds) => {
                        // Create a proper copy to avoid reference issues
                        return nds.map((node) => {
                            if (node.id === newNode.id) {
                                return {
                                    ...node,
                                    data: {
                                        ...node.data,
                                        webhook_id: webhook_id
                                    }
                                };
                            }
                            return node;
                        });
                    });

                    console.log(`Registered webhook ID ${webhook_id} for node ${newNode.id}`);
                } catch (error) {
                    console.error('Error registering webhook:', error);
                    // Remove the node if registration failed
                    setNodes((nds) => nds.filter(node => node.id !== newNode.id));
                    alert("Failed to register webhook. Please try again.");
                }
            } else {
                // For non-webhook nodes, simply add the new node to the existing ones
                setNodes((nds) => {
                    // Create a proper copy to avoid reference issues
                    const newNodes = [...nds];
                    newNodes.push(newNode);
                    return newNodes;
                });
            }
        },
        [screenToFlowPosition, workflowId, setNodes]
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
            // Use relative URL for consistency with Vite proxy
            const response = await axios.post('/api/workflows', workflowData);
            alert(`Workflow saved successfully! ID: ${response.data.workflow_id}`);
            setWorkflowId(response.data.workflow_id); // Ensure ID is set after save

            // Refresh the workflow list to include the newly saved workflow
            await fetchWorkflows();
        } catch (error) {
            console.error("Error saving workflow:", error);
            alert(`Error saving workflow: ${error.response?.data?.detail || error.message}`);
        }
    };

    // Function to fetch all workflows from the API
    const fetchWorkflows = async () => {
        try {
            const response = await axios.get('/api/workflows');
            setAvailableWorkflows(response.data || []);
            console.log("Fetched workflows:", response.data);
        } catch (error) {
            console.error("Error fetching workflows:", error);
        }
    };

    // Fetch workflows when the component mounts
    useEffect(() => {
        fetchWorkflows();
    }, []);

    // Update ID counter when available workflows are loaded
    useEffect(() => {
        if (availableWorkflows.length > 0) {
            // Collect all nodes from all workflows
            const allNodes = availableWorkflows.flatMap(workflow => workflow.nodes || []);
            // Update the ID counter based on all existing nodes
            updateIdCounterFromNodes(allNodes);
        }
    }, [availableWorkflows]);

    const handleLoadWorkflow = async () => {
        try {
            // Use selected workflow ID from dropdown if available, otherwise use the input field or current workflow ID
            const workflowIdToLoad = selectedWorkflowId || loadWorkflowIdInput || workflowId;
            if (!workflowIdToLoad) {
                console.error("No workflow ID to load");
                return;
            }

            const response = await axios.get(`/api/workflows/${workflowIdToLoad}`);
            if (response.data) {
                const workflow = response.data;

                // Extract nodes and edges
                const loadedNodes = workflow.nodes || [];
                let loadedEdges = workflow.edges || [];

                // Update the ID counter to avoid conflicts with existing node IDs
                updateIdCounterFromNodes(loadedNodes);

                // Reset node execution status
                setNodeExecutionStatus({});

                // Map model configuration to LLM connections with custom edge styling
                loadedEdges = loadedEdges.map(edge => {
                    // Find source and target nodes to check their types
                    const sourceNode = loadedNodes.find(node => node.id === edge.source);
                    const targetNode = loadedNodes.find(node => node.id === edge.target);

                    if (sourceNode && targetNode) {
                        // If this is a connection between model_config and llm, use custom edge type
                        if ((sourceNode.type === 'model_config' && targetNode.type === 'llm') ||
                            (sourceNode.type === 'llm' && targetNode.type === 'model_config')) {
                            return {
                                ...edge,
                                type: 'modelConfig',
                                animated: true
                            };
                        }
                    }

                    return edge;
                });

                setNodes(loadedNodes);
                setEdges(loadedEdges);
                setWorkflowName(workflow.name || 'Imported Workflow');
                setWorkflowId(workflowIdToLoad);
                console.log("Workflow loaded successfully");

                // Register webhooks for any webhook_trigger nodes without webhook_id
                const webhookTriggerNodes = loadedNodes.filter(node =>
                    node.type === 'webhook_trigger' && !node.data?.webhook_id
                );

                if (webhookTriggerNodes.length > 0) {
                    console.log(`Registering webhooks for ${webhookTriggerNodes.length} webhook trigger nodes`);

                    // Register webhooks for each node that needs one
                    for (const node of webhookTriggerNodes) {
                        try {
                            const response = await axios.post('/api/webhooks/register', {
                                workflow_id: workflowIdToLoad,
                                node_id: node.id
                            });

                            const webhook_id = response.data.webhook_id;

                            // Update the node with the webhook ID
                            setNodes(nds => {
                                return nds.map(n => {
                                    if (n.id === node.id) {
                                        return {
                                            ...n,
                                            data: {
                                                ...n.data,
                                                webhook_id: webhook_id
                                            }
                                        };
                                    }
                                    return n;
                                });
                            });

                            console.log(`Registered webhook ID ${webhook_id} for node ${node.id}`);
                        } catch (error) {
                            console.error(`Error registering webhook for node ${node.id}:`, error);
                        }
                    }
                }
            } else {
                console.error("No workflow data returned");
            }
        } catch (error) {
            console.error("Error loading workflow:", error);
        }
    };

    const handleRunWorkflow = async () => {
        if (!workflowId) {
            alert("Please save or load a workflow before running.");
            return;
        }

        // Check for validation errors
        const errors = validateWorkflow();
        const errorCount = Object.keys(errors).length;

        if (errorCount > 0) {
            alert(`Cannot run workflow: ${errorCount} node${errorCount > 1 ? 's have' : ' has'} validation errors. Please fix them first.`);
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
            const response = await axios.post(`/api/workflows/${workflowId}/run`, {});
            const runId = response.data.run_id;

            if (!runId) throw new Error("Backend did not return a run_id.");

            console.log(`Obtained run_id: ${runId}. Connecting to SSE stream...`);
            // Clear initiating message before streaming starts
            setRunLogs([]);

            const sseUrl = `/api/workflows/${workflowId}/runs/${runId}/stream`;
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

    // Helper function to create edges between model config and LLM nodes
    const createModelConfigEdge = useCallback((modelConfigId, llmNodeId) => {
        // Check if edge already exists
        const edgeExists = edges.some(edge =>
            (edge.source === modelConfigId && edge.target === llmNodeId) ||
            (edge.source === llmNodeId && edge.target === modelConfigId)
        );

        if (!edgeExists) {
            const newEdge = {
                id: `edge-${modelConfigId}-${llmNodeId}`,
                source: modelConfigId,
                target: llmNodeId,
                type: 'modelConfig',
                animated: true
            };

            setEdges(prevEdges => [...prevEdges, newEdge]);
        }
    }, [edges, setEdges]);

    // Helper function to remove edges between model config and LLM nodes
    const removeModelConfigEdge = useCallback((modelConfigId, llmNodeId) => {
        setEdges(prevEdges => prevEdges.filter(edge => {
            // Filter out any edge connecting these two nodes in either direction
            return !((edge.source === modelConfigId && edge.target === llmNodeId) ||
                (edge.source === llmNodeId && edge.target === modelConfigId));
        }));
    }, [setEdges]);

    // Custom edges change handler to update nodes when model config edges are removed
    const handleEdgesChange = useCallback((changes) => {
        // Process the changes first to identify edge removals
        const removedEdges = [];

        changes.forEach(change => {
            if (change.type === 'remove') {
                // Find the edge that's being removed
                const edgeToRemove = edges.find(edge => edge.id === change.id);
                if (edgeToRemove && edgeToRemove.type === 'modelConfig') {
                    removedEdges.push(edgeToRemove);
                }
            }
        });

        // Apply the standard edge changes
        onEdgesChange(changes);

        // If any modelConfig edges were removed, update the corresponding LLM nodes
        if (removedEdges.length > 0) {
            setNodes(currentNodes => {
                return currentNodes.map(node => {
                    // Check if this node is connected to any of the removed edges
                    const connectedEdge = removedEdges.find(edge =>
                        (edge.source === node.id || edge.target === node.id)
                    );

                    if (connectedEdge && node.type === 'llm') {
                        // If this is an LLM node connected to a removed modelConfig edge,
                        // remove its model_config_id
                        return {
                            ...node,
                            data: {
                                ...node.data,
                                model_config_id: '' // Clear the model config reference
                            }
                        };
                    }
                    return node;
                });
            });
        }
    }, [edges, onEdgesChange, setNodes]);

    // Add this effect to poll for webhook updates
    useEffect(() => {
        // Only poll if there are webhook_trigger nodes in the workflow
        const webhookNodes = nodes.filter(node => node.type === 'webhook_trigger' && node.data?.webhook_id);

        if (webhookNodes.length === 0 || !workflowId) return;

        // Poll every 5 seconds
        const intervalId = setInterval(async () => {
            try {
                // Fetch the current workflow to get latest node data
                const response = await axios.get(`/api/workflows/${workflowId}`);
                const updatedWorkflow = response.data;

                if (!updatedWorkflow || !updatedWorkflow.nodes) return;

                // Check each webhook node for updates
                let hasUpdates = false;
                const updatedNodes = nodes.map(node => {
                    if (node.type === 'webhook_trigger' && node.data?.webhook_id) {
                        // Find the matching node in the updated workflow
                        const updatedNode = updatedWorkflow.nodes.find(n => n.id === node.id);
                        if (updatedNode && updatedNode.data?.last_payload &&
                            JSON.stringify(updatedNode.data.last_payload) !== JSON.stringify(node.data.last_payload)) {
                            // We have an update
                            hasUpdates = true;
                            return {
                                ...node,
                                data: {
                                    ...node.data,
                                    last_payload: updatedNode.data.last_payload
                                }
                            };
                        }
                    }
                    return node;
                });

                if (hasUpdates) {
                    setNodes(updatedNodes);
                }
            } catch (error) {
                console.error('Error polling webhook updates:', error);
            }
        }, 5000);

        return () => clearInterval(intervalId);
    }, [nodes, workflowId]);

    return (
        <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
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
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                    height: '100%',
                    bgcolor: 'background.default',
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
                        <FormControl
                            variant="outlined"
                            size="small"
                            sx={{
                                mr: 1,
                                minWidth: 200,
                                backgroundColor: 'rgba(255,255,255,0.15)',
                                borderRadius: 1
                            }}
                        >
                            <InputLabel
                                id="workflow-select-label"
                                sx={{ color: '#eee' }}
                            >
                                Select Workflow
                            </InputLabel>
                            <Select
                                labelId="workflow-select-label"
                                value={selectedWorkflowId}
                                onChange={(e) => setSelectedWorkflowId(e.target.value)}
                                label="Select Workflow"
                                sx={{ color: 'white' }}
                            >
                                <MenuItem value="">
                                    <em>None</em>
                                </MenuItem>
                                {availableWorkflows.map((workflow) => (
                                    <MenuItem key={workflow.id} value={workflow.id}>
                                        {workflow.name} ({workflow.id})
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        <Button
                            variant="outlined"
                            size="small"
                            onClick={fetchWorkflows}
                            sx={{ mr: 1 }}
                        >
                            <RefreshIcon fontSize="small" />
                        </Button>
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
                        minHeight: 0, // Key to allow parent container to limit the height
                        position: 'relative'
                    }}
                >
                    <ReactFlow
                        nodes={nodes}
                        edges={edges}
                        onNodesChange={onNodesChange}
                        onEdgesChange={handleEdgesChange}
                        onConnect={onConnect}
                        onDragOver={onDragOver}
                        onDrop={onDrop}
                        nodeTypes={nodeTypes}
                        edgeTypes={edgeTypes}
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

            {/* Node Configuration Panel (Modal) */}
            <NodeConfigPanel
                node={configNode}
                nodes={nodes}
                onUpdate={updateNodeData}
                onClose={() => setConfigNode(null)}
                open={!!configNode}
                onCreateEdge={createModelConfigEdge}
                onRemoveEdge={removeModelConfigEdge}
            />
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