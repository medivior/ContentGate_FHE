pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract ContentGate is ZamaEthereumConfig {
    struct AccessRule {
        euint32 encryptedThreshold;
        uint256 publicTokenId;
        address tokenContract;
        uint256 createdAt;
        bool isActive;
    }

    struct Content {
        string contentId;
        string encryptedContent;
        uint256 accessRuleIndex;
        address owner;
        uint256 createdAt;
        bool isPublished;
    }

    AccessRule[] public accessRules;
    mapping(uint256 => Content[]) private ruleContents;
    mapping(string => Content) public contentRegistry;

    event AccessRuleCreated(uint256 indexed ruleIndex, address indexed creator);
    event ContentPublished(string indexed contentId, uint256 indexed ruleIndex);
    event ContentAccessed(string indexed contentId, address indexed accessor);

    modifier onlyRuleOwner(uint256 ruleIndex) {
        require(accessRules[ruleIndex].tokenContract == msg.sender, "Not rule owner");
        _;
    }

    constructor() ZamaEthereumConfig() {}

    function createAccessRule(
        externalEuint32 encryptedThreshold,
        bytes calldata inputProof,
        uint256 publicTokenId,
        address tokenContract
    ) external {
        require(tokenContract != address(0), "Invalid token contract");
        require(FHE.isInitialized(FHE.fromExternal(encryptedThreshold, inputProof)), "Invalid encrypted threshold");

        accessRules.push(AccessRule({
            encryptedThreshold: FHE.fromExternal(encryptedThreshold, inputProof),
            publicTokenId: publicTokenId,
            tokenContract: tokenContract,
            createdAt: block.timestamp,
            isActive: true
        }));

        FHE.allowThis(accessRules[accessRules.length - 1].encryptedThreshold);
        FHE.makePubliclyDecryptable(accessRules[accessRules.length - 1].encryptedThreshold);

        emit AccessRuleCreated(accessRules.length - 1, msg.sender);
    }

    function publishContent(
        string calldata contentId,
        string calldata encryptedContent,
        uint256 ruleIndex
    ) external onlyRuleOwner(ruleIndex) {
        require(accessRules[ruleIndex].isActive, "Rule inactive");
        require(contentRegistry[contentId].owner == address(0), "Content ID exists");

        Content memory newContent = Content({
            contentId: contentId,
            encryptedContent: encryptedContent,
            accessRuleIndex: ruleIndex,
            owner: msg.sender,
            createdAt: block.timestamp,
            isPublished: true
        });

        contentRegistry[contentId] = newContent;
        ruleContents[ruleIndex].push(newContent);

        emit ContentPublished(contentId, ruleIndex);
    }

    function accessContent(
        string calldata contentId,
        bytes memory abiEncodedClearBalance,
        bytes memory decryptionProof
    ) external {
        Content storage content = contentRegistry[contentId];
        require(content.isPublished, "Content not available");

        AccessRule storage rule = accessRules[content.accessRuleIndex];
        require(rule.isActive, "Rule inactive");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(rule.encryptedThreshold);

        FHE.checkSignatures(cts, abiEncodedClearBalance, decryptionProof);

        uint32 decodedBalance = abi.decode(abiEncodedClearBalance, (uint32));
        require(decodedBalance >= rule.publicTokenId, "Insufficient balance");

        emit ContentAccessed(contentId, msg.sender);
    }

    function getAccessRule(uint256 ruleIndex) external view returns (
        euint32 encryptedThreshold,
        uint256 publicTokenId,
        address tokenContract,
        uint256 createdAt,
        bool isActive
    ) {
        AccessRule storage rule = accessRules[ruleIndex];
        return (
            rule.encryptedThreshold,
            rule.publicTokenId,
            rule.tokenContract,
            rule.createdAt,
            rule.isActive
        );
    }

    function getContent(string calldata contentId) external view returns (
        string memory encryptedContent,
        uint256 accessRuleIndex,
        address owner,
        uint256 createdAt,
        bool isPublished
    ) {
        Content storage content = contentRegistry[contentId];
        return (
            content.encryptedContent,
            content.accessRuleIndex,
            content.owner,
            content.createdAt,
            content.isPublished
        );
    }

    function getContentsForRule(uint256 ruleIndex) external view returns (Content[] memory) {
        return ruleContents[ruleIndex];
    }

    function updateRuleStatus(uint256 ruleIndex, bool newStatus) external onlyRuleOwner(ruleIndex) {
        accessRules[ruleIndex].isActive = newStatus;
    }

    function isAvailable() public pure returns (bool) {
        return true;
    }
}


